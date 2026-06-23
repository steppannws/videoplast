// Tauri shell for videoplaster. Owns the kiosk window and the lifecycle of the
// Leap bridge sidecar. The web frontend is unchanged: it still talks to the
// bridge over ws://localhost:7681, and the bridge still emits TUIO on UDP :3333.
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Fixed bridge endpoints (see the standalone-app design spec). Not user-configurable yet.
const WS_PORT: &str = "7681";
const TUIO_IP: &str = "127.0.0.1";
const TUIO_PORT: &str = "3333";

// Holds the spawned bridge child so it can be killed when the app exits.
#[derive(Default)]
struct BridgeProc(Mutex<Option<CommandChild>>);

// Spawn the frozen Python bridge as a sidecar and pipe its output to our logs.
// A missing sidecar (e.g. dev run before the bridge is frozen) is non-fatal: the
// frontend's mouse source and all effects still work; only the Leap-IR source needs it.
fn spawn_bridge(app: &tauri::AppHandle) {
    let cmd = match app.shell().sidecar("videoplaster-bridge") {
        Ok(c) => c.args([
            "--ws-port", WS_PORT,
            "--tuio-ip", TUIO_IP,
            "--tuio-port", TUIO_PORT,
        ]),
        Err(e) => {
            eprintln!("[bridge] sidecar unavailable: {e} (mouse source + effects still work)");
            return;
        }
    };
    match cmd.spawn() {
        Ok((mut rx, child)) => {
            *app.state::<BridgeProc>().0.lock().unwrap() = Some(child);
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(b) => print!("[bridge] {}", String::from_utf8_lossy(&b)),
                        CommandEvent::Stderr(b) => eprint!("[bridge] {}", String::from_utf8_lossy(&b)),
                        _ => {}
                    }
                }
            });
        }
        Err(e) => eprintln!("[bridge] failed to spawn: {e}"),
    }
}

// Kill the bridge child (if any) so no orphan process is left after exit.
fn kill_bridge(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BridgeProc>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance must be the first plugin; a second launch focuses the window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(BridgeProc::default())
        .setup(|app| {
            spawn_bridge(&app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the videoplaster tauri app")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                kill_bridge(app);
            }
        });
}
