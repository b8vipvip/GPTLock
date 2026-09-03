from pathlib import Path

path = Path('.github/tmp_fix_model_indicator_v0538.py')
source = path.read_text().replace('name = "gptlock-core"', 'name = "gptwork-core"')
exec(compile(source, str(path), 'exec'))
