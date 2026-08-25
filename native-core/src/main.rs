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
    let mut arguments = env::args().skip(1);
    let command = arguments.next().unwrap_or_else(|| "native".to_owned());

    if matches!(command.as_str(), "--help" | "-h" | "help") {
        print_help();
        return Ok(());
    }
    if matches!(command.as_str(), "--version" | "-V" | "version") {
        println!("gptlock-core {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    let store = ConfigStore::discover()?;
    let state = AppState::initialize(store)?;

    match command.as_str() {
        "native" => bridge::run_native_host(state),
        "serve" => {
            let address = parse_listen_address(arguments.collect())?;
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
