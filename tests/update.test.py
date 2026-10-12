import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('manage',pathlib.Path(__file__).resolve().parents[1]/'macos/manage.py')
manage=importlib.util.module_from_spec(spec);spec.loader.exec_module(manage)
class UpdateTests(unittest.TestCase):
    def fixture(self,tmp):
        base=pathlib.Path(tmp);runtime=base/'Runtime';package=base/'Package'
        files=['lib/engine.js','lib/renderer.js','plugins/auto-continue.js','macos/loader.cjs','macos/manage.py','macos/compatibility.json']
        for name in files:
            for root,text in [(runtime,'old'),(package,'new')]:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
        (package/'macos/compatibility.json').write_text(json.dumps({'version':'test','asarHash':'hash'}))
        app=runtime/'Claude.app/Contents';app.mkdir(parents=True);(app/'signed-file').write_text('untouched')
        (runtime/'manifest.json').write_text(json.dumps({'marker':manage.MARKER,'claudeVersion':'test','original':{'asarHash':'hash'}}))
        return base,runtime,package
    def test_updates_sources_and_backs_up_without_touching_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'ensure_closed'),patch.object(manage,'log'),patch.object(manage,'launch') as launch:
                manage.update();launch.assert_called_once()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'new')
            self.assertEqual((runtime/'Claude.app/Contents/signed-file').read_text(),'untouched')
            self.assertEqual(next((base/'Backups').glob('Plugin-*/lib/engine.js')).read_text(),'old')
    def test_incomplete_update_refuses_before_app_shutdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(package/'lib/renderer.js').unlink()
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid') as pid:
                with self.assertRaisesRegex(RuntimeError,'missing'):manage.update()
                pid.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
if __name__=='__main__':unittest.main()
