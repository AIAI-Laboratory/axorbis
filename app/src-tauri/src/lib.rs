mod commands;

use commands::ReviewState;
use tauri::RunEvent;

pub fn run() {
    let reviews = ReviewState::default();
    let shutdown = reviews.clone();
    tauri::Builder::default()
        .manage(reviews)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::review_environment,
            commands::list_google_keys,
            commands::add_google_key,
            commands::remove_google_key,
            commands::choose_workspace,
            commands::start_review,
            commands::list_reviews,
            commands::read_review,
            commands::review_input,
            commands::reference_graph,
            commands::update_review,
            commands::delete_review,
            commands::read_review_artifact,
            commands::cancel_review,
            commands::open_review_output,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Axorbis literature review desktop application")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                shutdown.stop();
            }
        });
}
