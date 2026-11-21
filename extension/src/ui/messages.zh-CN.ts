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
  "common.yes": "是",
  "common.no": "否",

  "build.mode.bootstrap": "引导构建",
  "build.mode.production": "正式构建",

  "editor.pageTitle": "MonacoAnywhere 编辑器",
  "editor.heading": "MonacoAnywhere {version} · {mode} 测试页",
  "editor.ariaLabel": "MonacoAnywhere C++ 编辑器测试页（支持本机草稿恢复）",
  "editor.status.initial": "此构建中语言服务不可用。草稿只保存在本机。",
  "editor.status.bootstrap":
    "语言服务不可用——当前为引导构建。编辑、C++ 语法高亮与本机草稿自动保存可用；没有 clangd 引擎、数据包或 OOBE 验证。",
  "editor.status.production":
    "语言服务不可用——此构建没有 LSP 会话。编辑、C++ 语法高亮与本机草稿自动保存可用；引擎集成不属于本阶段。",
  "editor.status.noCpp":
    "cpp 语言定义未注册，语法高亮不可用；编辑与本机草稿仍可使用。本构建未实现语言服务。",
  "editor.status.badTheme":
    "无法应用编辑器主题“{theme}”：{error}。已使用系统默认主题；此构建中语言服务仍不可用。",
  "editor.status.settingsError":
    "无法读取设置：{error}。已使用默认值；语言服务仍不可用。",
  "editor.draft.scopeAnon":
    "草稿范围：匿名——此测试页没有站点账号。站点编辑器比较字段保持为空，草稿只保存在本机。",
  "editor.draft.saved": "草稿已于 {time} 保存到本机。",
  "editor.draft.unchanged": "草稿已与本机存储一致，无需再次写入。",
  "editor.draft.restored": "已恢复本机草稿。自动保存仍仅限本机。",
  "editor.draft.discarded": "已保留测试页文本。只有在你下次编辑后才会替换已存草稿。",
  "editor.draft.saveError": "无法保存本机草稿：{error}",
  "editor.draft.loadError":
    "无法读取本机草稿：{error}。自动保存已暂停；重试后再关闭此标签页。",
  "editor.draft.restoreTitle": "恢复本机草稿？",
  "editor.draft.restoreBody":
    "此编辑器在本机存有于 {time} 保存的草稿。恢复将替换测试页文本；选择测试页会保留它直到你编辑。任何内容都不会上传。",
  "editor.draft.restore": "恢复草稿",
  "editor.draft.useFixture": "使用测试页文本",
  "editor.draft.conflictTitle": "两个标签页修改了同一草稿",
  "editor.draft.conflictLegend": "选择要保留的副本（两侧预览均为只读）",
  "editor.draft.conflictBody":
    "本页上次保存于 {thisTime}；存储副本更新于 {otherTime}。请明确选择，不会静默覆盖。",
  "editor.draft.otherActive": "另一标签页仍持有有效的草稿租约。",
  "editor.draft.otherInactive": "没有有效租约；另一份副本已过期，可以替换。",
  "editor.draft.thisPage": "使用本页",
  "editor.draft.otherPage": "使用另一页",
  "editor.draft.keepNewer": "保留较新的草稿",
  "editor.draft.newerThis": "本页较新。",
  "editor.draft.newerOther": "另一页较新。",
  "editor.draft.previewThis": "本页",
  "editor.draft.previewOther": "另一页存储的副本",
  "editor.draft.empty": "（空）",
  "editor.draft.applyChoice": "应用选择",
  "editor.draft.decideLater": "稍后决定",
  "editor.draft.resolve": "解决草稿冲突",
  "editor.draft.retrySave": "重试本机保存",
  "editor.draft.deferred": "冲突未解决。此草稿的自动保存已暂停，直到你做出选择。",
  "editor.draft.leaseLost":
    "另一个标签页已持有此草稿的本机租约。本页自动保存已暂停；请重试以明确取回。",
  "editor.draft.remoteChanged":
    "另一标签页更新了此草稿。下次保存前会先询问，不会直接覆盖。",
  "editor.draft.conflictResolved": "草稿冲突已解决：{choice}。",
  "editor.draft.conflictStale": "另一份副本又发生了变化；请查看刷新后的比较。",

  "onboarding.pageTitle": "MonacoAnywhere 设置",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "设置 MonacoAnywhere",
  "onboarding.intro":
    "此四步向导会依次选择后端、检查资源、运行一次真实测试台验证，之后才能完成设置。此构建没有数据下载器、clangd 会话或测试台验证客户端，因此无法完成设置，也从不写入 onboardingComplete。",
  "onboarding.steps.ariaLabel": "设置步骤",
  "onboarding.steps.backend": "后端",
  "onboarding.steps.resources": "资源",
  "onboarding.steps.validation": "验证",
  "onboarding.steps.complete": "完成",
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
    "检查只读取随包构建信息，不会下载任何内容或启动语言服务。继续不会把资源或设置标记为就绪。",
  "onboarding.resources.wasmBody":
    "此构建没有数据下载客户端，也未随包提供引擎或工具链数据包。以下检查只报告实际打包的内容。",
  "onboarding.resources.nativeBody":
    "请使用此扩展 ID 从 host/dist 安装本机宿主，然后运行检测。检测会发送真实的 Native Messaging 请求；此构建未提供宿主或 LSP 会话。",
  "onboarding.resources.check": "检查随包资源",
  "onboarding.resources.detect": "检测本机宿主",
  "onboarding.resources.nativeCommand": "宿主安装命令",
  "onboarding.resources.wasmNotChecked": "尚未检查资源。",
  "onboarding.resources.nativeNotChecked":
    "尚未检测本机宿主。请选择“检测本机宿主”。",
  "onboarding.resources.checking": "正在检查随包资源…",
  "onboarding.resources.nativeChecking": "正在联系本机宿主…",
  "onboarding.resources.artifact.present": "存在",
  "onboarding.resources.artifact.absent": "不存在",
  "onboarding.resources.downloader.missing": "下载客户端尚未实现",
  "onboarding.resources.wasmProbe":
    "资源尚未就绪：{downloader}；随包引擎 {engine}；数据目录 {catalogue}；数据包 {packs} 个。未尝试任何下载。",
  "onboarding.resources.nativeMissing":
    "未检测到本机宿主：{error}。请安装后重试，或更改后端。语言服务与验证仍不可用。",
  "onboarding.resources.nativeEmpty":
    "本机宿主进程未返回数据，检测不完整。未验证任何内容。",
  "onboarding.resources.nativeFailed": "本机宿主检测失败：{error}",
  "onboarding.resources.nativeResponded":
    "本机宿主已有响应（{detail}）。此构建仍没有 LSP 会话或测试台验证客户端，因此设置无法完成。",
  "onboarding.resources.checkError": "无法检查资源：{error}",
  "onboarding.resources.chooseBackend": "请先选择后端再检查资源。",
  "onboarding.validation.title": "验证",
  "onboarding.validation.description":
    "验证必须针对内置测试台运行一次真实的 {method} 请求，并显示返回的条目数。此构建没有 clangd 会话或测试台验证客户端，因此无法发送请求。",
  "onboarding.validation.check": "检查验证可用性",
  "onboarding.validation.changeBackend": "更改后端",
  "onboarding.validation.readyToCheck":
    "验证预计不可用。选择“检查验证可用性”可读取真实的随包前置条件；不会发送任何请求。",
  "onboarding.validation.checking": "正在检查验证可用性…",
  "onboarding.validation.clientMissing": "尚未实现",
  "onboarding.validation.unavailable":
    "{backend} 的验证不可用：随包引擎 {engine}；测试台验证客户端 {client}。未发送任何补全请求，onboardingComplete 保持为 false。",
  "onboarding.validation.checkFailed": "无法检查验证可用性：{error}",
  "onboarding.validation.completeNote":
    "只有真实测试台验证成功后才能完成设置。你的后端选择会保留，不会自动切换。",
  "onboarding.guidance.wasm.title": "WASM 后端",
  "onboarding.guidance.wasm.first":
    "WASM clangd 引擎与工具链数据包不属于此集成，因此不会尝试下载或验证测试台。",
  "onboarding.guidance.wasm.second":
    "引擎与下载器集成后，设置流程必须显示进度指示器下载数据包，并在使用前校验其 SHA-256。",
  "onboarding.guidance.native.title": "本机后端",
  "onboarding.guidance.native.first":
    "请使用此扩展 ID 从 host/dist 安装本机宿主。“检测本机宿主”按钮会发送真实的 Native Messaging 请求；此构建没有可用的 LSP 会话。",
  "onboarding.guidance.native.second":
    "成功检测到宿主也不会完成设置：此构建没有测试台验证客户端，因此从不写入 onboardingComplete。",
  "onboarding.validation.chooseBackend": "请先选择后端。验证尚无法运行。",
  "onboarding.error.selectBackend": "继续之前请选择一个后端。默认不预选任何后端。",
  "onboarding.info.saved":
    "后端选择已保存。设置尚未完成：此构建中资源与验证仍不可用。",
  "onboarding.info.validationUnavailable":
    "未发送任何验证请求。设置仍未完成，onboardingComplete 保持为 false。",
  "onboarding.info.resourceUnavailable":
    "资源准备不可用。你可以查看验证步骤，但此构建中它无法成功。",
  "onboarding.error.save": "无法保存后端选择：{error}",
  "onboarding.error.openOptions": "无法打开选项：{error}",
  "onboarding.info.completeStored":
    "存储报告 onboardingComplete=true，但此构建无法验证。不会写入新的完成状态。",
  "onboarding.complete.title": "完成设置",
  "onboarding.complete.blocked":
    "设置尚未完成。真实测试台验证尚未成功，因此未写入 onboardingComplete。",
  "onboarding.complete.stored":
    "存储报告 onboardingComplete=true，但此构建无法验证，也不会写入新的完成状态。",
  "onboarding.complete.requirementStatus":
    "前置条件：已选择后端、资源已准备、真实测试台验证成功。",
  "onboarding.complete.requirements":
    "此构建无法满足资源准备或测试台验证。语言服务仍不可用；你仍可编辑并管理偏好。",
  "onboarding.complete.finish": "完成设置",
  "onboarding.error.init": "设置页面初始化失败：{error}",

  "options.pageTitle": "MonacoAnywhere 选项",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "选项",
  "options.intro":
    "偏好集中保存在 settings:v1，标注为即时的项目会立即应用。此构建没有 clangd 引擎、本机宿主集成或测试台验证，因此不会声称任何后端可用。",
  "options.services.title": "语言服务与编辑器",
  "options.backend.label": "后端偏好",
  "options.backend.none": "未选择后端",
  "options.backend.wasm": "WASM clangd",
  "options.backend.native": "本机 clangd",
  "options.backend.help":
    "默认不预选。保存后端不会验证它，也不会把设置标记为完成。",
  "options.theme.label": "主题",
  "options.theme.system": "跟随系统",
  "options.theme.light": "浅色",
  "options.theme.dark": "深色",
  "options.locale.label": "界面语言",
  "options.locale.auto": "跟随浏览器",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "隐藏标签页暂停（毫秒）",
  "options.hiddenPause.help": "引擎集成后用于 WASM 会话。",
  "options.clangdPath.label": "clangd 路径",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help": "本机宿主集成后使用；此处不会检查。",
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
    "偏好已集中保存。未验证任何后端；设置完成状态未改变。",
  "options.info.backendChanged":
    "后端偏好已保存。由于后端选择已更改，之前的设置完成状态已清除；请重新完成设置。",
  "options.info.themeSaved": "主题已保存并应用。",
  "options.info.localeSaved": "界面语言已保存并应用。",
  "options.error.preferenceSave": "无法保存此项偏好：{error}",
  "options.error.save": "无法保存偏好：{error}",
  "options.error.openSetup": "无法打开设置向导：{error}",
  "options.error.init": "选项页面初始化失败：{error}",
  "options.state.title": "当前状态",
  "options.state.none":
    "未选择后端。设置未完成，验证不可用，此构建未实现语言服务。",
  "options.state.backend":
    "后端偏好：{backend}。onboardingComplete={complete}。此构建不会验证该后端。",
  "options.state.siteOverrides": "按站点覆盖的后端：{count} 个。",
  "options.state.note":
    "只有真实测试台验证成功才会写入 onboardingComplete，此构建未实现该验证。WASM 引擎、数据包、本机宿主、站点适配器与 LSP 会话仍属后续工作。",
  "options.loading": "正在加载偏好…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "MonacoAnywhere · {mode} · {version}",
  "popup.statusAria": "状态",
  "popup.backend.label": "后端",
  "popup.backend.none": "未选择后端",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "本机 clangd",
  "popup.services.label": "语言服务",
  "popup.services.unavailable": "此构建不可用",
  "popup.registrations.label": "内容脚本",
  "popup.registrations.count": "已注册 {count} 个",
  "popup.oobe.incomplete":
    "设置未完成。验证可用后可完成设置；此构建中验证不可用。",
  "popup.oobe.stored":
    "存储显示 onboardingComplete=true，但此构建未验证它。",
  "popup.continueSetup": "继续设置",
  "popup.openSetup": "打开设置向导",
  "popup.openOptions": "打开选项",
  "popup.openFixture": "打开 Monaco 测试页",
  "popup.error.openSetup": "无法打开设置向导：{error}",
  "popup.error.openOptions": "无法打开选项：{error}",
  "popup.error.openFixture": "无法打开测试页：{error}",
  "popup.error.init": "弹出窗口初始化失败：{error}",
  "popup.loading": "正在加载状态…"
} as const satisfies Record<MessageKey, string>;
