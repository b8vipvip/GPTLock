use std::env;
use std::net::SocketAddr;

use anyhow::{bail, Context, Result};
use gptlock_core::config::ConfigStore;
use gptlock_core::{api, bridge, AppState};

const DEFAULT_LISTEN_ADDRESS: &str = "127.0.0.1:17856";

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("GPTLock 启动失败 / failed to start: {error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let (command, command_arguments) = resolve_invocation(&arguments)?;

    if matches!(command, "--help" | "-h" | "help") {
        print_help();
        return Ok(());
    }
    if matches!(command, "--version" | "-V" | "version") {
        println!("gptlock-core {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    let store = ConfigStore::discover()?;
    let state = AppState::initialize(store)?;

    match command {
        "native" => bridge::run_native_host(state),
        "serve" => {
            let address = parse_listen_address(command_arguments.to_vec())?;
            api::serve(address, state).await
        }
        "doctor" => {
            let report = state.doctor_report()?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            Ok(())
        }
        other => bail!("unknown command / 未知命令: {other}"),
    }
}

fn resolve_invocation(arguments: &[String]) -> Result<(&str, &[String])> {
    let Some(first) = arguments.first() else {
        return Ok(("native", &[]));
    };

    if is_chromium_extension_origin(first) {
        if arguments[1..]
            .iter()
            .all(|value| is_parent_window_argument(value))
        {
            return Ok(("native", &[]));
        }
        bail!("unexpected native host arguments / 非预期的本地主机参数");
    }

    Ok((first.as_str(), &arguments[1..]))
}

fn is_chromium_extension_origin(value: &str) -> bool {
    let Some(extension_id) = value
        .strip_prefix("chrome-extension://")
        .and_then(|value| value.strip_suffix('/'))
    else {
        return false;
    };
    extension_id.len() == 32
        && extension_id
            .bytes()
            .all(|byte| (b'a'..=b'p').contains(&byte))
}

fn is_parent_window_argument(value: &str) -> bool {
    value
        .strip_prefix("--parent-window=")
        .is_some_and(|handle| {
            !handle.is_empty() && handle.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn parse_listen_address(arguments: Vec<String>) -> Result<SocketAddr> {
    let value = match arguments.as_slice() {
        [] => DEFAULT_LISTEN_ADDRESS,
        [flag, value] if flag == "--listen" => value,
        _ => bail!("usage / 用法: gptlock-core serve [--listen 127.0.0.1:17856]"),
    };
    let address: SocketAddr = value
        .parse()
        .context("invalid listen address / 监听地址无效")?;
    if !address.ip().is_loopback() {
        bail!("only loopback addresses are allowed / 只允许本机回环地址");
    }
    Ok(address)
}

fn print_help() {
    println!(
        "GPTLock 本地核心 / Local Core\n\n\
         用法 / Usage:\n  \
         gptlock-core native                 启动浏览器 Native Messaging（默认）\n  \
         gptlock-core serve [--listen ADDR]  启动本机 API（默认 127.0.0.1:17856）\n  \
         gptlock-core doctor                 输出脱敏诊断信息\n  \
         gptlock-core --version              输出版本"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn defaults_to_native_mode_without_arguments() {
        let values = arguments(&[]);
        let (command, command_arguments) = resolve_invocation(&values).unwrap();
        assert_eq!(command, "native");
        assert!(command_arguments.is_empty());
    }

    #[test]
    fn accepts_chromium_native_host_origin_and_windows_parent_handle() {
        let values = arguments(&[
            "chrome-extension://bhchcpeodphgjfjoookncemnamdbfcof/",
            "--parent-window=0",
        ]);
        let (command, command_arguments) = resolve_invocation(&values).unwrap();
        assert_eq!(command, "native");
        assert!(command_arguments.is_empty());
    }

    #[test]
    fn preserves_explicit_cli_commands_and_arguments() {
        let values = arguments(&["serve", "--listen", "127.0.0.1:17857"]);
        let (command, command_arguments) = resolve_invocation(&values).unwrap();
        assert_eq!(command, "serve");
        assert_eq!(command_arguments, &values[1..]);
    }

    #[test]
    fn rejects_unexpected_arguments_after_native_origin() {
        let values = arguments(&[
            "chrome-extension://bhchcpeodphgjfjoookncemnamdbfcof/",
            "--write-chat-data",
        ]);
        assert!(resolve_invocation(&values).is_err());
    }

    #[test]
    fn rejects_malformed_extension_origins() {
        for origin in [
            "chrome-extension://too-short/",
            "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/",
            "https://bhchcpeodphgjfjoookncemnamdbfcof/",
        ] {
            let values = arguments(&[origin]);
            assert_eq!(resolve_invocation(&values).unwrap().0, origin);
        }
    }
}
