fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "nuvex_connect",
            "nuvex_request",
            "nuvex_events",
            "nuvex_events_control",
            "nuvex_dispose",
        ]),
    ))
    .expect("Could not generate the restricted native command manifest");
}
