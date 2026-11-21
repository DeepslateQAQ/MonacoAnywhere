/*
 * Simplified Chinese message table.
 *
 * Key set must exactly match messages.en.ts; the build fails otherwise.
 */
import type { MessageKey } from "./messages.en.js";

export const messages = {
  "common.appName": "MonacoAnywhere",
  "common.confirm": "确定",
  "common.cancel": "取消",
  "common.back": "返回",
  "common.continue": "继续",
  "common.openOptions": "打开选项",
  "common.extensionId": "扩展 ID",
  "common.unavailable": "不可用",

  "build.mode.bootstrap": "引导构建",
  "build.mode.production": "正式构建",

  "editor.pageTitle": "MonacoAnywhere 编辑器",
  "editor.heading": "MonacoAnywhere {version} · {mode} 测试页",
  "editor.ariaLabel": "MonacoAnywhere C++ 编辑器测试页",
  "editor.status.initial": "此构建中语言服务不可用。",
  "editor.status.bootstrap":
    "语言服务不可用——当前为引导构建。编辑与 C++ 语法高亮可用；本阶段没有 clangd 引擎、数据包或 OOBE 验证。",
  "editor.status.production":
    "语言服务不可用——此骨架构建没有 LSP 会话。编辑与 C++ 语法高亮可用；引擎集成不属于本阶段。",
  "editor.status.noCpp":
    "cpp 语言定义未注册，语法高亮不可用；编辑仍可正常使用。本构建未实现语言服务。",

  "onboarding.pageTitle": "MonacoAnywhere 设置",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "设置 MonacoAnywhere",
  "onboarding.intro":
    "此向导通常会选择语言服务后端、准备资源并运行一次真实测试台检查。当前引导构建只能记录你的选择，无法验证后端或完成设置。",
  "onboarding.steps.ariaLabel": "设置步骤",
  "onboarding.steps.backend": "后端",
  "onboarding.steps.resources": "资源",
  "onboarding.steps.validation": "验证",
  "onboarding.choose.title": "选择后端",
  "onboarding.choose.legend": "语言服务后端",
  "onboarding.backend.wasm.title": "WASM clangd",
  "onboarding.backend.wasm.description":
    "在扩展内运行。需要下载工具链数据包，并使用随扩展打包的 WASM 引擎。",
  "onboarding.backend.native.title": "本机 clangd",
  "onboarding.backend.native.description":
    "使用另外安装的本机宿主与这台电脑上的 clangd。",
  "onboarding.choose.hint":
    "默认不预选任何后端。某个后端失败时不会静默切换到另一个后端。",
  "onboarding.resources.title": "准备资源",
  "onboarding.resources.note":
    "资源下载、本机宿主检测与引擎不属于此骨架构建。此处不会下载或启动任何内容。",
  "onboarding.validation.title": "验证",
  "onboarding.validation.description":
    "真实设置会针对内置测试台运行一次 {method} 请求，并显示返回的条目数。此构建没有 clangd 会话，因此该检查已禁用。",
  "onboarding.validation.disabledButton": "此构建无法进行验证",
  "onboarding.validation.initialStatus": "此构建有意不提供验证。",
  "onboarding.validation.completeNote":
    "设置尚未完成，也不会写入 onboardingComplete。你仍可查看编辑器测试页并调整偏好。",
  "onboarding.guidance.wasm.title": "WASM 后端",
  "onboarding.guidance.wasm.first":
    "WASM clangd 引擎与工具链数据包不在当前骨架构建中，因此不会尝试下载或验证测试台。",
  "onboarding.guidance.wasm.second":
    "引擎就绪后，设置流程会显示进度指示器下载数据包，并在使用前校验其 SHA-256。",
  "onboarding.guidance.native.title": "本机后端",
  "onboarding.guidance.native.first":
    "请使用此扩展 ID 从 host/dist 安装本机宿主，然后在选项中选用本机后端。宿主、clangd 检测与语言服务尚未在本阶段实现。",
  "onboarding.guidance.native.second":
    "此处有意不提供检测。后续步骤会运行真实的宿主检查并报告检测到的 clangd 版本。",
  "onboarding.validation.chooseBackend":
    "请先选择后端。此骨架构建仍无法进行验证。",
  "onboarding.validation.unavailable":
    "此构建有意不提供验证：没有 clangd 引擎或数据包，也未发送任何测试台请求。无法在此构建中完成设置。",
  "onboarding.error.selectBackend": "继续之前请选择一个后端。默认不预选任何后端。",
  "onboarding.info.saved":
    "后端选择已保存。这不会完成设置：此构建无法进行验证。",
  "onboarding.error.save": "无法保存后端选择：{error}",
  "onboarding.error.openOptions": "无法打开选项：{error}",
  "onboarding.info.completeStored":
    "存储报告 onboardingComplete=true，但此骨架构建无法验证。不会写入新的完成状态。",
  "onboarding.error.init": "设置页面初始化失败：{error}",

  "options.pageTitle": "MonacoAnywhere 选项",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "选项",
  "options.intro":
    "偏好保存在本机。此引导构建没有 clangd 引擎、本机宿主集成或测试台验证，因此不会声称任何后端可用。",
  "options.services.title": "语言服务与编辑器",
  "options.backend.label": "后端偏好",
  "options.backend.none": "未选择后端",
  "options.backend.wasm": "WASM clangd",
  "options.backend.native": "本机 clangd",
  "options.backend.help": "默认不预选。更改此项不会验证后端。",
  "options.theme.label": "主题",
  "options.theme.system": "跟随系统",
  "options.theme.light": "浅色",
  "options.theme.dark": "深色",
  "options.locale.label": "界面语言",
  "options.locale.auto": "跟随浏览器",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "隐藏标签页暂停（毫秒）",
  "options.hiddenPause.help": "集成后用于 WASM 会话。",
  "options.clangdPath.label": "clangd 路径",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help": "本机宿主存在后使用；此处不会检查。",
  "options.editorFont.label": "编辑器字体",
  "options.editorTheme.label": "编辑器主题",
  "options.advanced.legend": "高级",
  "options.queryDriver.label": "query-driver 白名单",
  "options.queryDriver.placeholder": "每行一个 glob，或用逗号分隔",
  "options.queryDriver.help": "仅用于本机宿主配置。此构建不会应用。",
  "options.extraIncludes.label": "额外头文件目录",
  "options.extraIncludes.placeholder": "每行一个路径，或用逗号分隔",
  "options.extraIncludes.help": "集成后作为独立的编译器参数传入。",
  "options.save": "保存偏好",
  "options.openSetup": "打开设置向导",
  "options.error.unsupportedBackend": "不支持的后端选择。",
  "options.error.pauseRange": "暂停延迟必须是介于 {min} 与 {max} 毫秒之间的整数。",
  "options.info.saved":
    "偏好已保存到本机。未验证任何后端；此构建中 OOBE 仍未完成。",
  "options.error.save": "无法保存偏好：{error}",
  "options.error.openSetup": "无法打开设置向导：{error}",
  "options.error.init": "选项页面初始化失败：{error}",
  "options.state.title": "当前状态",
  "options.state.none":
    "未选择后端。设置未完成，此构建中语言服务不可用。",
  "options.state.backend":
    "后端偏好：{backend}。onboardingComplete={complete}。此骨架构建无法验证任一后端。",
  "options.state.note":
    "此构建从不设置 onboardingComplete。WASM 引擎、数据包、本机宿主、站点适配器与 LSP 会话仍属后续工作。",
  "options.loading": "正在加载偏好…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "骨架构建 · {mode} · {version}",
  "popup.statusAria": "状态",
  "popup.backend.label": "后端",
  "popup.backend.none": "未选择后端",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "本机 clangd",
  "popup.registrations.label": "内容脚本",
  "popup.registrations.count": "已注册 {count} 个",
  "popup.oobe.incomplete": "设置未完成。此构建中语言服务不可用。",
  "popup.oobe.stored":
    "存储显示 onboardingComplete=true，但此骨架构建无法验证。",
  "popup.openSetup": "打开设置向导",
  "popup.openOptions": "打开选项",
  "popup.openFixture": "打开 Monaco 测试页",
  "popup.error.openSetup": "无法打开设置向导：{error}",
  "popup.error.openOptions": "无法打开选项：{error}",
  "popup.error.openFixture": "无法打开测试页：{error}",
  "popup.error.init": "弹出窗口初始化失败：{error}",
  "popup.loading": "正在加载状态…"
} as const satisfies Record<MessageKey, string>;
