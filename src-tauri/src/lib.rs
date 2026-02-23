use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    ffmpeg_process: Mutex<Option<std::process::Child>>,
}

#[tauri::command]
fn start_stream(ip: String, port: String, app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut ffmpeg_proc_guard = state.ffmpeg_process.lock().unwrap();
    if ffmpeg_proc_guard.is_some() {
        return Ok(()); // Already running
    }

    let cmd_str = format!(
        "ssh root@{} -p {} -o StrictHostKeyChecking=no -o BatchMode=yes \"while true; do dd if=/dev/fb0 bs=1872 count=2480 2>/dev/null; sleep 1; done\" | ffmpeg -loglevel warning -f rawvideo -pixel_format gray -video_size 1872x2480 -framerate 1 -i - -vf \"crop=1860:2480:0:0\" -r 1 -f image2pipe -vcodec mjpeg pipe:1",
        ip, port
    );

    let mut child = Command::new("sh")
        .arg("-c")
        .arg(cmd_str)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start process: {}", e))?;

    let mut stdout = child.stdout.take().unwrap();
    *ffmpeg_proc_guard = Some(child);

    thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut chunk = vec![0u8; 40960]; // 40KB chunk
        
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    buffer.extend_from_slice(&chunk[..n]);
                    
                    loop {
                        let start_index = buffer.windows(2).position(|w| w == [0xff, 0xd8]);
                        if let Some(start) = start_index {
                            let end_index = buffer[start..].windows(2).position(|w| w == [0xff, 0xd9]);
                            if let Some(end_offset) = end_index {
                                let end = start + end_offset + 2;
                                let frame = buffer[start..end].to_vec();
                                
                                // Emit to frontend
                                app_handle.emit("frame", frame).ok();
                                
                                buffer.drain(..end);
                                continue;
                            }
                        }
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_stream(state: State<'_, AppState>) -> Result<(), String> {
    let mut ffmpeg_proc_guard = state.ffmpeg_process.lock().unwrap();
    if let Some(mut child) = ffmpeg_proc_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ffmpeg_process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_stream, stop_stream])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
