# LabelPlusX

LabelPlusX 是一个现代化、多平台的 LabelPlus 客户端，面向漫画、条漫、图片翻译等工作流。

它兼容旧版 LabelPlus 的 `txt` 工作区格式，同时把原本偏传统、偏模式化的桌面流程，改造成一套同时支持桌面端和 Web 的直接交互式编辑体验。

## 支持目标

- 基于 Tauri 的桌面端应用：macOS / Linux / Windows
- 可自部署的 Web 版本
- GitHub Pages 部署
- Docker 自部署镜像

## 项目能力

- 打开旧版 LabelPlus `txt` 工作区
- 从图片新建工作区
- 图片预览、缩放、平移、marker 编辑
- 直接在图片上新增、拖动、删除 label
- 使用 QuickText 快速录入短语
- 管理分组、备注、检查模式
- 桌面端回写原始 `txt`，Web 端保存到本地存储

## 主要功能

### 工作区

- 兼容旧版 LabelPlus 文本格式
- Web 模式下可直接从图片新建工作区
- Tauri 模式下可从项目文件夹新建工作区
- 桌面端自动生成 `translation.txt` 风格的工作文件
- 保留分组定义与备注信息

### 图片预览

- 滚轮缩放
- 拖动画面平移
- 双击空白处新增 label
- 右键 label 删除
- 拖动 label 调整坐标
- 单击 label 选中
- 双击 label 自动居中到该标签

### 翻译编辑

- 单行式翻译列表，便于快速扫读
- 当前标签文本编辑区
- 当前标签分类切换
- 快速跳到未翻译条目
- 支持撤销 / 重做
- 键盘流友好，适合连续录入

### QuickText

- 向当前文本框快速插入短语
- 在预览图上直接落点创建带短语的新 label
- 可在设置页自定义短语与按键
- macOS 使用 `Option + A`，其他平台使用 `Alt + A`

### 检查模式

- 正常编辑与检查视图切换
- 支持横排 / 竖排阅读布局
- 支持检查模式字体大小调整
- 文本直接覆盖显示在图片上

### 保存逻辑

- Web：保存到浏览器本地存储
- Tauri：保存回原始工作区 `txt` 文件
- 支持自动保存

## 平台说明

### Web

- 导入已有 LabelPlus `txt`
- 手动关联本地图片
- 直接从图片创建新工作区
- 编辑结果保存到浏览器本地存储

### Tauri 桌面端

- 打开已有本地 LabelPlus 工作区
- 选择项目文件夹创建新工作区
- 直接保存回原始 `txt`
- 可打包为 macOS / Linux / Windows 桌面程序

## 快捷键

快捷键一览也可以在应用内设置面板中查看。常用快捷键包括：

- `1 - 9`：切换当前分组
- `Delete / Backspace`：删除当前选中 label
- `Cmd/Ctrl + S`：保存
- `Cmd/Ctrl + Z`、`Cmd/Ctrl + Y`：撤销 / 重做
- `Left / Right`：上一张 / 下一张图片
- `Cmd/Ctrl + Enter`：编辑时跳到下一条
- `V`：按住时临时隐藏 label
- `R`：图片适配
- `C`：开关检查模式
- `W`：切换阅读布局
- `Enter`：聚焦当前标签文本框
- `Option/Alt + A`：打开 QuickText

## 技术栈

- React 19
- TypeScript
- Vite
- Tauri 2
- Rust

## 项目结构

- `src/`：React 前端
- `src/lib/labelplus.ts`：旧版 LabelPlus 文本解析与序列化
- `src/lib/tauri.ts`：桌面端桥接逻辑
- `src-tauri/`：Tauri + Rust 后端
- `.github/workflows/`：CI、桌面构建、Docker、Pages 部署
- `Dockerfile`：Web 自部署镜像

## 开发方式

安装依赖：

```bash
npm ci
```

启动 Web 开发：

```bash
npm run dev
```

启动 Tauri 桌面开发：

```bash
npm run tauri dev
```

检查与构建：

```bash
npm run lint
npm run build
cd src-tauri && cargo check
```

## 生产构建

构建 Web：

```bash
npm run build
```

构建桌面端安装包：

```bash
npm run tauri build
```

## 部署

### GitHub Actions

仓库内已经包含以下自动化流程：

- 桌面端多平台构建
- Docker 镜像构建与发布
- GitHub Pages 自动部署

### GitHub Pages

Web 版本可通过 `.github/workflows/pages.yml` 自动部署到 GitHub Pages。

### Docker

本地构建：

```bash
docker build -t labelplusx-web .
```

本地运行：

```bash
docker run --rm -p 8080:80 labelplusx-web
```

然后访问 `http://localhost:8080`。

## Photoshop 配合使用

LabelPlusX 可以和原本用于 Photoshop 的导入脚本一起使用：

- 仓库地址：`https://github.com/LabelPlus/PS-Script`

典型配合流程：

1. 在 LabelPlusX 中创建或编辑 LabelPlus `txt` 工作区。
2. 保存或导出工作区文本。
3. 在 Photoshop 中打开 PSD 工作流。
4. 使用 `PS-Script` 读取 LabelPlus 文本，并在 PSD 中生成对应文字图层。

Photoshop 脚本负责的部分：

- 将 LabelPlus 文本导入 Photoshop
- 按翻译条目生成文字图层
- 支持按文件或分组选择性导入
- 支持替换图源与文字格式设置
- 支持导入时执行 Photoshop 动作

如果你仍然依赖 Photoshop 做最终排版，推荐分工如下：

- LabelPlusX：工作区管理、图片预览、label 编辑、QuickText、检查模式、保存/导出
- PS-Script：把文本导入 PSD，并接 Photoshop 批处理流程

## 首次使用教程

### Web：从图片开始

1. 打开 Web 版本。
2. 点击 `新建工作区`。
3. 选择要纳入工作区的图片。
4. 系统会自动生成一个新的空白工作区。
5. 在图片上双击空白区域新增 label。
6. 在右侧填写翻译内容。
7. 编辑结果会保存在浏览器本地存储。

### Web：打开已有 LabelPlus 文本

1. 点击 `导入工作区`。
2. 选择已有的 LabelPlus `txt` 文件。
3. 如果需要，使用 `关联本地图片` 补充对应图片。
4. 继续编辑 label、分组和翻译文本。

### Tauri：新建桌面项目

1. 启动桌面端应用。
2. 点击 `新建工作区`。
3. 选择包含源图片的项目文件夹。
4. LabelPlusX 会自动扫描图片并生成新的工作文件。
5. 新工作区会立即载入。
6. 编辑完成后可直接保存回原始 `txt` 文件。

### Tauri：打开已有本地项目

1. 点击 `导入工作区`。
2. 选择已有的 LabelPlus `txt` 工作文件。
3. LabelPlusX 会自动从同目录读取对应本地图片。
4. 编辑后可直接保存回源文件。

## 典型工作流

### 1. 创建或打开工作区

- Web：从图片新建，或导入已有 `txt`
- Tauri：从项目文件夹新建，或导入已有 `txt`

### 2. 浏览图片列表

- 左侧用于切换工作区文件
- 键盘切图时，列表会自动跟随到当前项
- 缩略图可用于确认图片匹配是否正常

### 3. 添加 label

- 双击图片空白区域新增 label
- 新增时自动使用当前选中的分组
- 拖动 label 调整位置

### 4. 填写翻译文本

- 从预览区或右侧列表选择 label
- 在当前标签编辑框中输入文本
- 使用 QuickText 快速录入重复短语
- 按 `Cmd/Ctrl + Enter` 连续跳到下一条继续翻译

### 5. 使用分组

- 左侧分组 chip 可切换当前分组
- 可直接修改分组名称
- 只有空分组才允许删除

### 6. 检查模式复核

- 从预览工具栏切换检查模式
- 在横排 / 竖排之间切换
- 在设置中调整检查模式字体大小

### 7. 保存

- Web：保存到浏览器本地存储
- Tauri：保存回原始工作区文件
- 可使用 `Cmd/Ctrl + S` 手动保存

## 当前状态

LabelPlusX 目前已经覆盖主要日常工作流：

- 新建或导入工作区
- 初始化图片
- 编辑 label 与翻译文本
- 使用 QuickText
- 进入检查模式
- 保存或导出旧版文本

后续仍然可以继续扩展，但核心链路已经可用于正式工作。

## License

详见 `LICENSE`。
