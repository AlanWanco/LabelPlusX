use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LabelEntry {
    id: usize,
    x_percent: f32,
    y_percent: f32,
    category: i32,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    name: String,
    labels: Vec<LabelEntry>,
    image_path: Option<String>,
    image_src: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceData {
    label_path: String,
    groups: Vec<String>,
    comment: String,
    files: Vec<WorkspaceFile>,
}

#[derive(Default)]
struct StartBlocks {
    groups: Vec<String>,
    comment: String,
}

#[tauri::command]
fn load_workspace(path: String) -> Result<WorkspaceData, String> {
    let workspace_path = PathBuf::from(&path);
    let content = fs::read_to_string(&workspace_path)
        .map_err(|error| format!("读取工作文件失败: {error}"))?;
    let mut files = parse_workspace_files(&content)?;
    let start_blocks = parse_start_blocks(&content);
    let parent_dir = workspace_path.parent().unwrap_or_else(|| Path::new("."));

    for file in &mut files {
        let image_path = parent_dir.join(&file.name);
        if image_path.is_file() {
            file.image_path = Some(image_path.to_string_lossy().into_owned());
            file.image_src = build_image_data_url(&image_path).ok();
        }
    }

    Ok(WorkspaceData {
        label_path: workspace_path.to_string_lossy().into_owned(),
        groups: start_blocks.groups,
        comment: start_blocks.comment,
        files,
    })
}

#[tauri::command]
fn save_workspace(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|error| format!("保存工作文件失败: {error}"))
}

#[tauri::command]
fn create_workspace(path: String) -> Result<WorkspaceData, String> {
    let project_dir = PathBuf::from(&path);
    if !project_dir.is_dir() {
        return Err("所选路径不是文件夹".to_string());
    }

    let mut image_names = fs::read_dir(&project_dir)
        .map_err(|error| format!("读取项目文件夹失败: {error}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_supported_image(path))
        .filter_map(|path| path.file_name().and_then(|value| value.to_str()).map(|value| value.to_string()))
        .collect::<Vec<_>>();

    image_names.sort_unstable();

    if image_names.is_empty() {
        return Err("项目文件夹中没有可用图片".to_string());
    }

    let label_path = next_workspace_file_path(&project_dir);
    let content = build_new_workspace_text(&image_names);
    fs::write(&label_path, content).map_err(|error| format!("创建工作文件失败: {error}"))?;

    load_workspace(label_path.to_string_lossy().into_owned())
}

fn parse_workspace_files(content: &str) -> Result<Vec<WorkspaceFile>, String> {
    let mut files = Vec::new();
    let mut current_file: Option<WorkspaceFile> = None;
    let mut current_label_header: Option<(usize, f32, f32, i32)> = None;
    let mut current_label_lines: Vec<String> = Vec::new();
    let mut start_parsed = false;

    for raw_line in content.replace("\r\n", "\n").split('\n') {
        let line = raw_line.trim();

        if let Some(file_name) = parse_file_head(line) {
            start_parsed = true;
            finalize_label(&mut current_file, &mut current_label_header, &mut current_label_lines);
            if let Some(file) = current_file.take() {
                files.push(file);
            }
            current_file = Some(WorkspaceFile {
                name: file_name,
                labels: Vec::new(),
                image_path: None,
                image_src: None,
            });
            continue;
        }

        if !start_parsed {
            continue;
        }

        if let Some((id, x, y, category)) = parse_label_head(line)? {
            finalize_label(&mut current_file, &mut current_label_header, &mut current_label_lines);
            current_label_header = Some((id, x, y, category));
            current_label_lines.clear();
            continue;
        }

        if current_label_header.is_some() {
            current_label_lines.push(raw_line.to_string());
        }
    }

    finalize_label(&mut current_file, &mut current_label_header, &mut current_label_lines);
    if let Some(file) = current_file.take() {
        files.push(file);
    }

    Ok(files)
}

fn build_image_data_url(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "图片缺少扩展名".to_string())?;

    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return Err(format!("不支持的图片格式: {extension}")),
    };

    let bytes = fs::read(path).map_err(|error| format!("读取图片失败: {error}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn is_supported_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif")
    )
}

fn next_workspace_file_path(project_dir: &Path) -> PathBuf {
    let primary = project_dir.join("translation.txt");
    if !primary.exists() {
        return primary;
    }

    for index in 2..=999 {
        let candidate = project_dir.join(format!("translation_{index}.txt"));
        if !candidate.exists() {
            return candidate;
        }
    }

    project_dir.join("translation_1000.txt")
}

fn build_new_workspace_text(image_names: &[String]) -> String {
    let mut lines = vec![
        "1,0".to_string(),
        "-".to_string(),
        "框内".to_string(),
        "框外".to_string(),
        "-".to_string(),
        "".to_string(),
    ];

    for image_name in image_names {
        lines.push(String::new());
        lines.push(format!(">>>>>>>>[{image_name}]<<<<<<<<"));
    }

    format!("{}\r\n", lines.join("\r\n"))
}

fn finalize_label(
    current_file: &mut Option<WorkspaceFile>,
    current_label_header: &mut Option<(usize, f32, f32, i32)>,
    current_label_lines: &mut Vec<String>,
) {
    let Some(file) = current_file.as_mut() else {
        return;
    };
    let Some((id, x_percent, y_percent, category)) = current_label_header.take() else {
        return;
    };

    file.labels.push(LabelEntry {
        id,
        x_percent,
        y_percent,
        category,
        text: current_label_lines.join("\n").trim().to_string(),
    });
    current_label_lines.clear();
}

fn parse_file_head(line: &str) -> Option<String> {
    if line.starts_with(">>>>>>>>[") && line.ends_with("]<<<<<<<<") && line.len() > 19 {
        return Some(line[9..line.len() - 9].to_string());
    }

    None
}

fn parse_label_head(line: &str) -> Result<Option<(usize, f32, f32, i32)>, String> {
    if !(line.starts_with("----------------[") && line.contains("]----------------")) {
        return Ok(None);
    }

    let split_index = line
        .find("]----------------")
        .ok_or_else(|| "标签头格式错误".to_string())?;
    let id = line[17..split_index]
        .parse::<usize>()
        .map_err(|error| format!("标签序号解析失败: {error}"))?;
    let right = &line[split_index + 17..];

    if right.is_empty() {
        return Ok(Some((id, 0.0, 0.0, 1)));
    }

    let values = right
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .ok_or_else(|| "标签坐标块缺失方括号".to_string())?
        .split(',')
        .map(str::trim)
        .collect::<Vec<_>>();

    let x_percent = values
        .first()
        .unwrap_or(&"0")
        .parse::<f32>()
        .map_err(|error| format!("X 坐标解析失败: {error}"))?;
    let y_percent = values
        .get(1)
        .unwrap_or(&"0")
        .parse::<f32>()
        .map_err(|error| format!("Y 坐标解析失败: {error}"))?;
    let category = values
        .get(2)
        .unwrap_or(&"1")
        .parse::<i32>()
        .map_err(|error| format!("分类解析失败: {error}"))?;

    Ok(Some((id, x_percent, y_percent, category)))
}

fn parse_start_blocks(content: &str) -> StartBlocks {
    let mut start_lines = Vec::new();

    for raw_line in content.replace("\r\n", "\n").split('\n') {
        let line = raw_line.trim();
        if parse_file_head(line).is_some() {
            break;
        }
        start_lines.push(line.to_string());
    }

    let separators = start_lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| if line == "-" { Some(index) } else { None })
        .collect::<Vec<_>>();

    if separators.len() < 2 {
        return StartBlocks::default();
    }

    let groups = start_lines[separators[0] + 1..separators[1]]
        .iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let comment = start_lines[separators[1] + 1..].join("\n").trim().to_string();

    StartBlocks { groups, comment }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![load_workspace, save_workspace, create_workspace])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
