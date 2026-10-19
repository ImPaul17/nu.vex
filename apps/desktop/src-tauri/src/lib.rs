pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Could not start the nu.vex desktop window");
}
