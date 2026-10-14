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
        for root,text in [(runtime,'old'),(package,'new')]:
            renderer="const VERSION='fixture-mac-preview';\n"+text
            (root/'lib/renderer.js').write_text(renderer)
            (root/'plugins/auto-continue.js').write_text(
                '// Bundled safety engine preserves compatibility with the original one-file loader.\n'
                'if (typeof window !== "undefined" && !window.ClaudeAutoContinueEngine) {\n'
                +text+'\n}\n'+renderer)
        (package/'macos/compatibility.json').write_text(json.dumps({'version':'test','asarHash':'hash'}))
        app=runtime/'Claude.app/Contents';app.mkdir(parents=True);(app/'signed-file').write_text('untouched')
        (runtime/'manifest.json').write_text(json.dumps({'marker':manage.MARKER,'claudeVersion':'test','original':{'asarHash':'hash'}}))
        return base,runtime,package
    def original_fixture(self,base,runtime):
        original=base/'Original Claude.app';original.mkdir();(original/'signed-file').write_text('vendor app')
        backup=base/'Backups/original';backup.mkdir(parents=True);(backup/'signed-file').write_text('vendor app')
        preferences=base/'Claude-preferences';preferences.write_text('account data')
        manifest=json.loads((runtime/'manifest.json').read_text())
        manifest['original']['path']=str(original);manifest['backup']=str(backup)
        (runtime/'manifest.json').write_text(json.dumps(manifest))
        return original,backup,preferences
    def test_updates_sources_and_backs_up_without_touching_app(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'ensure_closed'),patch.object(manage,'verify_installed_app'),patch.object(manage,'log'),patch.object(manage,'launch') as launch:
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
    def test_failed_replacement_rolls_back_all_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);replace=pathlib.Path.replace
            def fail_second(path,target):
                if path.name=='renderer.js':raise OSError('simulated disk failure')
                return replace(path,target)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'ensure_closed'),patch.object(manage,'verify_installed_app'),patch.object(pathlib.Path,'replace',fail_second),patch.object(manage,'launch') as launch:
                with self.assertRaisesRegex(RuntimeError,'restored'):manage.update()
                launch.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertEqual((runtime/'lib/renderer.js').read_text(),"const VERSION='fixture-mac-preview';\nold")
            self.assertFalse(list(base.glob('Update-*')))
    def test_failed_staging_changes_no_installed_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);copy2=manage.shutil.copy2
            def fail_staging(source,target,*args,**kwargs):
                if pathlib.Path(source)==package/'lib/renderer.js':raise OSError('simulated download or disk failure')
                return copy2(source,target,*args,**kwargs)
            prior={name:(runtime/name).read_bytes() for name in manage.SOURCE_FILES}
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'ensure_closed'),patch.object(manage,'verify_installed_app'),patch.object(manage.shutil,'copy2',side_effect=fail_staging),patch.object(manage,'launch') as launch:
                with self.assertRaisesRegex(OSError,'simulated'):manage.update()
                launch.assert_not_called()
            self.assertEqual({name:(runtime/name).read_bytes() for name in manage.SOURCE_FILES},prior)
            self.assertFalse(list(base.glob('Update-*')))
    def test_stale_pid_does_not_hide_running_managed_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=pathlib.Path(tmp);(runtime/'status.json').write_text(json.dumps({'pid':99}))
            command=str(runtime/'Claude.app/Contents/MacOS/Claude')
            from types import SimpleNamespace
            with patch.object(manage,'RUNTIME',runtime),patch.object(manage,'run',side_effect=[SimpleNamespace(stdout=b'/another/app'),SimpleNamespace(stdout=('42 '+command).encode())]):
                self.assertEqual(manage.own_pid(),42)
    def test_changed_app_is_rejected_before_closing_or_replacing(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app',side_effect=RuntimeError('app changed')),patch.object(manage,'own_pid') as pid:
                with self.assertRaisesRegex(RuntimeError,'app changed'):manage.update()
                pid.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
    def test_stale_generated_bundle_is_rejected_before_shutdown(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(package/'lib/renderer.js').write_text('edited but not rebuilt')
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid') as pid:
                with self.assertRaisesRegex(RuntimeError,'does not match'):manage.update()
                pid.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertFalse((runtime/'shutdown.json').exists())
    def test_missing_sources_are_rejected_before_launching(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(runtime/'macos/loader.cjs').unlink()
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid') as pid:
                with self.assertRaisesRegex(RuntimeError,'missing'):manage.launch()
                pid.assert_not_called()
    def test_parallel_launcher_is_refused_until_the_operation_completes(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(manage,'BASE',pathlib.Path(tmp)):
            with manage.operation_lock():
                with self.assertRaisesRegex(RuntimeError,'already running'):
                    with manage.operation_lock():self.fail('A second operation acquired the lock.')
            with manage.operation_lock():pass
    def test_logging_failure_does_not_interrupt_install_or_update(self):
        with patch.object(pathlib.Path,'mkdir',side_effect=OSError('logs unavailable')):
            manage.log('plugin-updated')
    def test_launch_verification_rejects_stale_wrong_pid_and_malformed_status(self):
        good={'pid':42,'time':999000,'renderers':[{'widgets':1,'composer':True,'send':True,'rendererVersion':'fixture-mac-preview'}]}
        with patch.object(manage.time,'time',return_value=1000):
            self.assertTrue(manage.verified_status(good,42,'fixture-mac-preview'))
            for health in [[],{},dict(good,pid=99),dict(good,time=984000),dict(good,time=1000001),
                           dict(good,time='now'),dict(good,time=float('nan')),dict(good,renderers='not a list'),
                           dict(good,renderers=[None]),dict(good,renderers=[{'widgets':2,'composer':True,'send':True}]),
                           dict(good,renderers=[{'widgets':1,'composer':True,'send':False}])]:
                self.assertFalse(manage.verified_status(health,42,'fixture-mac-preview'),str(health))
            for widget,version in [(True,'fixture-mac-preview'),(1.0,'fixture-mac-preview'),(1,'stale-version'),(1,None)]:
                health=dict(good,renderers=[dict(good['renderers'][0],widgets=widget,rendererVersion=version)])
                self.assertFalse(manage.verified_status(health,42,'fixture-mac-preview'),str(health))
            self.assertFalse(manage.verified_status(good,42,'fixture-mac-preview',started=999.5))
    def test_malformed_live_health_reports_unverified_instead_of_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(runtime/'status.json').write_text('[]')
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid',return_value=42),patch.object(manage,'run') as run,patch.object(manage.time,'sleep'),patch.object(manage,'log'):
                self.assertFalse(manage.launch())
                run.assert_called_once_with('/usr/bin/open','-a',runtime/'Claude.app')
    def test_loader_source_failure_is_reported_without_waiting_three_minutes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(runtime/'status.json').write_text(json.dumps({'pid':42,'bundleReady':False}))
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid',return_value=42),patch.object(manage,'run'),patch.object(manage.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'could not be loaded'):manage.launch()
    def test_stale_status_from_another_process_cannot_report_a_loader_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);(runtime/'status.json').write_text(json.dumps({'pid':99,'bundleReady':False,'compatible':False}))
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid',return_value=42),patch.object(manage,'run'),patch.object(manage.time,'sleep'),patch.object(manage,'log'):
                self.assertFalse(manage.launch())
    def test_existing_running_copy_is_foregrounded_without_starting_another_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            health={'pid':42,'time':1000001,'renderers':[{'widgets':1,'composer':True,'send':True,'rendererVersion':'fixture-mac-preview'}]}
            (runtime/'status.json').write_text(json.dumps(health))
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid',return_value=42),patch.object(manage,'run') as run,patch.object(manage.time,'time',return_value=1000.002),patch.object(manage,'log'),patch.object(manage.subprocess,'Popen') as popen:
                self.assertTrue(manage.launch())
                run.assert_called_once_with('/usr/bin/open','-a',runtime/'Claude.app')
                popen.assert_not_called()
    def test_cold_launch_foregrounds_exact_copy_and_accepts_loaded_home_without_chat_controls(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            def run(*args,**kwargs):
                self.assertEqual(args,('/usr/bin/open','-n','-a',runtime/'Claude.app'))
                (runtime/'status.json').write_text(json.dumps({'pid':42,'time':1000001,'renderers':[{'widgets':1,'home':True,'state':'DISABLED','composer':False,'send':False,'rendererVersion':'fixture-mac-preview'}]}))
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'verify_installed_app'),patch.object(manage,'own_pid',side_effect=[None,42]),patch.object(manage,'ensure_closed'),patch.object(manage,'run',side_effect=run),patch.object(manage.time,'time',side_effect=[1000,1000.002,1000.002]),patch.object(manage.time,'sleep') as sleep,patch.object(manage,'log') as log:
                self.assertTrue(manage.launch())
                sleep.assert_not_called()
                log.assert_called_once_with('launch-widget-loaded',version='test')
    def test_home_loading_is_distinct_from_chat_readiness_and_requires_paused_state(self):
        health={'pid':42,'time':999000,'renderers':[{'widgets':1,'home':True,'state':'DISABLED','rendererVersion':'fixture-mac-preview'}]}
        with patch.object(manage.time,'time',return_value=1000):
            self.assertTrue(manage.verified_status(health,42,'fixture-mac-preview',home=True))
            self.assertFalse(manage.verified_status(health,42,'fixture-mac-preview'))
            for state in ['GENERATING','COUNTDOWN','WAITING',None]:
                bad=dict(health,renderers=[dict(health['renderers'][0],state=state)])
                self.assertFalse(manage.verified_status(bad,42,'fixture-mac-preview',home=True))
            self.assertFalse(manage.verified_status(dict(health,pid=9),42,'fixture-mac-preview',home=True))
            self.assertFalse(manage.verified_status(dict(health,time=984000),42,'fixture-mac-preview',home=True))
    def test_failed_updater_guard_blocks_launch_readiness(self):
        with self.assertRaisesRegex(RuntimeError,'vendor updater'):
            manage.check_loader_status({'pid':42,'vendorUpdatesBlocked':False},42)
        manage.check_loader_status({'pid':99,'vendorUpdatesBlocked':False},42)
    def test_pending_vendor_update_gate_only_blocks_existing_payload_for_exact_local_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=pathlib.Path(tmp);runtime=base/'Runtime';state=base/'ShipItState.plist'
            payload=base/'update.payload/Claude.app';payload.mkdir(parents=True)
            prior={'targetBundleURL':(runtime/'Claude.app').as_uri(),'updateBundleURL':payload.as_uri()}
            with patch.multiple(manage,RUNTIME=runtime,SHIPIT_STATE=state):
                state.write_text(json.dumps(prior));original=state.read_bytes()
                with self.assertRaisesRegex(RuntimeError,'vendor update is queued'):manage.check_pending_vendor_update()
                self.assertEqual(state.read_bytes(),original)
                state.write_text(json.dumps(dict(prior,targetBundleURL=(base/'Original Claude.app').as_uri())))
                manage.check_pending_vendor_update()
                state.write_text(json.dumps(dict(prior,updateBundleURL=(base/'missing payload/Claude.app').as_uri())))
                manage.check_pending_vendor_update()
                state.write_text('[]');manage.check_pending_vendor_update()
                state.write_text('unreadable JSON');manage.check_pending_vendor_update()
    def test_uninstall_preserves_original_backup_and_preferences(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);original,backup,preferences=self.original_fixture(base,runtime)
            from types import SimpleNamespace
            def run(*args,**kwargs):
                if args[0]=='/usr/bin/codesign':self.assertTrue(runtime.exists(),'Signature must be verified before removing the copy.')
                if args[0]=='/bin/ps':self.assertFalse(runtime.exists())
                return SimpleNamespace(stdout=(str(original/'Contents/MacOS/Claude')+'\n').encode())
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'log'),patch.object(manage,'run',side_effect=run):
                manage.uninstall()
            self.assertFalse(runtime.exists())
            self.assertEqual((original/'signed-file').read_text(),'vendor app')
            self.assertEqual((backup/'signed-file').read_text(),'vendor app')
            self.assertEqual(preferences.read_text(),'account data')
    def test_uninstall_never_removes_an_unclosed_running_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);self.original_fixture(base,runtime)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=42),patch.object(manage.time,'sleep'),patch.object(manage,'run') as run:
                with self.assertRaisesRegex(RuntimeError,'No app files were removed'):manage.uninstall()
                run.assert_not_called()
            self.assertEqual((runtime/'Claude.app/Contents/signed-file').read_text(),'untouched')
    def test_uninstall_refuses_a_missing_or_invalid_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp);original,_,_=self.original_fixture(base,runtime)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'run',side_effect=RuntimeError('invalid signature')):
                with self.assertRaisesRegex(RuntimeError,'invalid signature'):manage.uninstall()
            self.assertTrue(runtime.exists())
            manage.shutil.rmtree(original)
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'run') as run:
                with self.assertRaisesRegex(RuntimeError,'Original app is missing'):manage.uninstall()
                run.assert_not_called()
            self.assertTrue(runtime.exists())
    def repair_fixture(self,tmp):
        base,runtime,package=self.fixture(tmp)
        original,_,preferences=self.original_fixture(base,runtime)
        source=base/'Baseline Claude.app';source.mkdir();(source/'signed-file').write_text('supported vendor app')
        logs=base/'Logs';logs.mkdir();(logs/'history.log').write_text('existing log')
        return base,runtime,package,original,source,preferences,logs
    def repair_mocks(self,base,runtime,package,original,source,logs):
        import contextlib
        stack=contextlib.ExitStack()
        stack.enter_context(patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package,LOGS=logs))
        stack.enter_context(patch.object(manage,'locate',side_effect=lambda explicit=None:pathlib.Path(explicit) if explicit else original))
        def detect(app):
            self.assertTrue((app/'signed-file').exists())
            return {'path':str(app),'version':'new-native' if app==original else 'test','asarHash':'new-native-hash' if app==original else 'hash','vendorSigned':True}
        stack.enter_context(patch.object(manage,'detect',side_effect=detect))
        stack.enter_context(patch.object(manage,'modified_files',side_effect=lambda app:{'signed-file':manage.digest(app/'signed-file')}))
        def run(*args,**kwargs):
            self.assertEqual(args[0],'/usr/bin/ditto')
            manage.shutil.copytree(args[1],args[2])
        stack.enter_context(patch.object(manage,'run',side_effect=run))
        stack.enter_context(patch.object(manage,'patch_asar',side_effect=lambda app:(app/'signed-file').write_text('patched local copy')))
        stack.enter_context(patch.object(manage,'sign_copy'))
        stack.enter_context(patch.object(manage,'ensure_closed'))
        stack.enter_context(patch.object(manage,'log'))
        stack.enter_context(patch.object(manage,'launch'))
        return stack
    def test_repair_preserves_previous_runtime_native_original_preferences_and_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs):
                manage.repair(source)
                manage.launch.assert_called_once()
            manifest=json.loads((runtime/'manifest.json').read_text())
            self.assertEqual(manifest['source']['version'],'test')
            self.assertEqual(pathlib.Path(manifest['source']['path'])/'signed-file',pathlib.Path(manifest['backup'])/'Claude.app/signed-file')
            self.assertEqual(manifest['original']['path'],str(original))
            self.assertEqual(manifest['original']['version'],'new-native')
            self.assertEqual((pathlib.Path(manifest['previousRuntime'])/'Claude.app/Contents/signed-file').read_text(),'untouched')
            self.assertEqual((runtime/'Claude.app/signed-file').read_text(),'patched local copy')
            self.assertEqual((runtime/'lib/engine.js').read_text(),'new')
            self.assertEqual((original/'signed-file').read_text(),'vendor app')
            self.assertEqual(preferences.read_text(),'account data')
            self.assertEqual((logs/'history.log').read_text(),'existing log')
            self.assertFalse(list(base.glob('.repair-*')))
    def test_repair_recovers_a_missing_runtime_from_verified_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            backup=base/'Backups/Claude-test-preserved/Claude.app';backup.parent.mkdir();source.rename(backup)
            manage.shutil.rmtree(runtime)
            with self.repair_mocks(base,runtime,package,original,backup,logs):manage.repair()
            manifest=json.loads((runtime/'manifest.json').read_text())
            self.assertIsNone(manifest['previousRuntime'])
            self.assertEqual((runtime/'Claude.app/signed-file').read_text(),'patched local copy')
            self.assertEqual((backup/'signed-file').read_text(),'supported vendor app')
            self.assertEqual(preferences.read_text(),'account data')
    def test_repair_refuses_unknown_source_before_backing_up_or_changing_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(manage,'detect',return_value={'version':'unknown','asarHash':'different','vendorSigned':True}):
                with self.assertRaisesRegex(RuntimeError,'tested baseline'):manage.repair(source)
                manage.run.assert_not_called()
                manage.launch.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertFalse(list(base.glob('.repair-*')))
    def test_repair_refuses_insufficient_disk_space_before_copying(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            from types import SimpleNamespace
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(manage.shutil,'disk_usage',return_value=SimpleNamespace(free=1)):
                with self.assertRaisesRegex(RuntimeError,'3 GB'):manage.repair(source)
                manage.run.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
    def test_failed_repair_signing_leaves_previous_runtime_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(manage,'sign_copy',side_effect=RuntimeError('signing failed')):
                with self.assertRaisesRegex(RuntimeError,'signing failed'):manage.repair(source)
                manage.launch.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertEqual((runtime/'Claude.app/Contents/signed-file').read_text(),'untouched')
            self.assertFalse(list(base.glob('.repair-*')))
    def test_failed_repair_directory_activation_restores_previous_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            rename=pathlib.Path.rename
            def fail_activation(path,target):
                if path.name.startswith('.repair-') and target==runtime:raise OSError('activation failed')
                return rename(path,target)
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(pathlib.Path,'rename',fail_activation):
                with self.assertRaisesRegex(OSError,'activation failed'):manage.repair(source)
                manage.launch.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertEqual((runtime/'Claude.app/Contents/signed-file').read_text(),'untouched')
            self.assertFalse(list(base.glob('.repair-*')))
    def test_failed_repair_post_activation_verification_restores_previous_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(manage,'verify_installed_app',side_effect=RuntimeError('verification failed')):
                with self.assertRaisesRegex(RuntimeError,'verification failed'):manage.repair(source)
                manage.launch.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
            self.assertEqual((runtime/'Claude.app/Contents/signed-file').read_text(),'untouched')
            self.assertFalse(list(base.glob('.repair-*')))
    def test_failed_repair_rollback_preserves_both_runtime_backups_for_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            rename=pathlib.Path.rename
            def fail_rollback(path,target):
                if path.name.startswith('Runtime-') and target==runtime:raise OSError('rollback disk failure')
                return rename(path,target)
            with self.repair_mocks(base,runtime,package,original,source,logs),patch.object(pathlib.Path,'rename',fail_rollback),patch.object(manage,'verify_installed_app',side_effect=RuntimeError('verification failed')):
                with self.assertRaisesRegex(RuntimeError,'rollback needs attention'):manage.repair(source)
                manage.launch.assert_not_called()
            self.assertEqual(next(base.glob('Backups/Runtime-*/lib/engine.js')).read_text(),'old')
            self.assertEqual(next(base.glob('.repair-*/lib/engine.js')).read_text(),'new')
            self.assertEqual((original/'signed-file').read_text(),'vendor app')
    def test_update_uses_pinned_source_compatibility_even_when_native_original_is_newer(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package=self.fixture(tmp)
            manifest=json.loads((runtime/'manifest.json').read_text())
            manifest['source']={'asarHash':'hash'}
            manifest['original']={'asarHash':'new-native-hash'}
            (runtime/'manifest.json').write_text(json.dumps(manifest))
            with patch.multiple(manage,BASE=base,RUNTIME=runtime,PACKAGE=package),patch.object(manage,'own_pid',return_value=None),patch.object(manage,'ensure_closed'),patch.object(manage,'verify_installed_app'),patch.object(manage,'log'),patch.object(manage,'launch'):
                manage.update()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'new')
    def test_repair_without_verified_baseline_changes_no_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs):
                with self.assertRaisesRegex(RuntimeError,'No verified supported Claude source'):manage.repair()
                manage.run.assert_not_called()
            self.assertEqual((runtime/'lib/engine.js').read_text(),'old')
    def test_pinned_source_survives_native_original_updates_but_source_or_copy_changes_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base,runtime,package,original,source,preferences,logs=self.repair_fixture(tmp)
            with self.repair_mocks(base,runtime,package,original,source,logs):
                manage.repair(source)
                manifest=manage.load_manifest()
                (original/'signed-file').write_text('a newer native app')
                manage.verify_installed_app(manifest)
                (runtime/'Claude.app/signed-file').write_text('vendor overwrote patched copy')
                with self.assertRaisesRegex(RuntimeError,'Local app changed'):manage.verify_installed_app(manifest)
                with patch.object(manage,'detect',return_value={'version':'unknown','asarHash':'different','vendorSigned':True}):
                    with self.assertRaisesRegex(RuntimeError,'tested baseline'):manage.verify_installed_app(manifest)
if __name__=='__main__':unittest.main()
