use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
struct FileInfo {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct Node {
    id: String,
    label: String,
}

#[derive(Serialize)]
struct Link {
    source: String,
    target: String,
}

#[derive(Serialize)]
struct GraphData {
    nodes: Vec<Node>,
    links: Vec<Link>,
}

#[tauri::command]
fn get_graph_data(root_path: String) -> Result<GraphData, String> {
    let mut nodes = Vec::new();
    let mut links = Vec::new();
    let mut seen_paths = HashSet::new();

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("Path does not exist".to_string());
    }

    let re = Regex::new(r"\[\[(.*?)\]\]").unwrap();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "md"))
    {
        let path_str = entry.path().to_string_lossy().into_owned();
        let name = entry.file_name().to_string_lossy().into_owned();
        let label = name.replace(".md", "");

        nodes.push(Node {
            id: path_str.clone(),
            label: label.clone(),
        });
        seen_paths.insert(label.clone());

        if let Ok(content) = fs::read_to_string(entry.path()) {
            for cap in re.captures_iter(&content) {
                let target_label = cap[1].to_string();
                // Simple link mapping for now: assume target is just the name
                links.push(Link {
                    source: path_str.clone(),
                    target: target_label, // This needs better matching in real use
                });
            }
        }
    }

    // Resolve target labels to paths
    for link in &mut links {
        for node in &nodes {
            if node.label == link.target {
                link.target = node.id.clone();
                break;
            }
        }
    }

    // Filter links that don't have a valid target path
    links.retain(|l| l.target.contains("/")); // Crude check for resolved path

    Ok(GraphData { nodes, links })
}

#[tauri::command]
fn list_files(root_path: String) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    let root = Path::new(&root_path);

    if !root.exists() {
        return Err("Path does not exist".to_string());
    }

    for entry in WalkDir::new(root)
        .max_depth(2) // Start with shallow listing for performance
        .into_iter()
        .filter_map(|e| e.ok())
    {
        // Skip the root itself
        if entry.path() == root {
            continue;
        }

        let path = entry.path().to_string_lossy().into_owned();
        let name = entry
            .file_name()
            .to_string_lossy()
            .into_owned();
        let is_dir = entry.file_type().is_dir();

        // Only include Markdown or directories
        if is_dir || name.ends_with(".md") {
            files.push(FileInfo { name, path, is_dir });
        }
    }

    Ok(files)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(parent_dir: String, name: String) -> Result<String, String> {
    let mut path = PathBuf::from(parent_dir);
    path.push(&name);
    if !name.ends_with(".md") {
        path.set_extension("md");
    }

    if path.exists() {
        return Err("File already exists".to_string());
    }

    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
