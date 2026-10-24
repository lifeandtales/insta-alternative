"""Give all local modules and styles a consistent cache version for browser previews."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
version = str(int(sys.argv[1]))
index = root / 'index.html'
text = index.read_text()
modules = {f'./{path.relative_to(root).as_posix()}': f'./{path.relative_to(root).as_posix()}?v={version}'
           for path in sorted((root / 'src').rglob('*.js'))}
import_map = '    <script type="importmap">\n' + json.dumps({'imports': modules}, indent=2) + '\n    </script>\n'
text = re.sub(r'    <script type="importmap">.*?</script>\n', '', text, flags=re.S)
text = re.sub(r'(styles\.css|app\.js)\?v=\d+', lambda match: match[1] + '?v=' + version, text)
text = text.replace('    <script type="module"', import_map + '    <script type="module"', 1)
index.write_text(text)
styles = root / 'styles.css'
styles.write_text(re.sub(r'\.css\?v=\d+', '.css?v=' + version, styles.read_text()))
