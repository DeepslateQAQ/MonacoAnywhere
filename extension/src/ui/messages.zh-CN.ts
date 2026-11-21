/*
 * Simplified Chinese message table.
 *
 * Key set must exactly match messages.en.ts; the build fails otherwise.
 */
import type { MessageKey } from "./messages.en.js";

export const messages = {
  "common.appName": "MonacoAnywhere",
  "common.confirm": "确定",
  "common.dismiss": "关闭",
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
  "editor.headingSuffix": "测试页",
  "editor.ariaLabel": "MonacoAnywhere C++ 编辑器（支持本地草稿恢复）",
  "editor.status.initial":
    "编辑器已就绪。草稿仅保存在本地，C++ 语言服务将使用所选后端。",
  "editor.standalone.ready": "空白 C++ 工作区",
  "editor.status.bootstrap":
    "当前为引导构建，不含语言服务引擎与工具链数据。编辑与本地草稿不受影响。",
  "editor.status.production":
    "C++ 语言服务尚未启动。在设置向导中选择后端即可启用，当前仍可正常编辑。",
  "editor.status.noCpp":
    "C++ 语法高亮未能加载。编辑与本地草稿不受影响。",
  "editor.status.badTheme":
    "无法应用主题“{theme}”：{error}。已回退为默认主题。",
  "editor.status.settingsError":
    "无法读取设置：{error}。已暂时使用默认配置，请在选项中检查后端设置。",
  "editor.status.lspNotConfigured":
    "请先在设置向导中选择后端，以启用 C++ 补全与诊断。",
  "editor.status.lspConnecting": "正在启动 C++ 语言服务并准备头文件…",
  "editor.status.lspReady": "C++ 服务已就绪",
  "editor.status.lspReconnecting":
    "语言服务连接断开，正在重连（{attempt}/{max}）…",
  "editor.status.lspClosedFinal":
    "语言服务多次异常退出：{reason}。代码已保留，重新打开编辑器即可重试。",
  "editor.status.lspError":
    "C++ 语言服务已停止：{error}。编辑与本地草稿不受影响。",
  "editor.status.lspPaused":
    "标签页在后台停留较久，WASM 语言服务已暂停，切回时将自动恢复。",
  "editor.status.lspUnavailable":
    "无法读取后端设置：{error}。编辑与本地草稿不受影响。",
  "editor.status.dataMissing":
    "工具链数据不可用：{error}。编辑与本地草稿不受影响。",
  "editor.draft.scopeAnon":
    "匿名草稿——仅保存在当前设备。",
  "editor.draft.saved": "已于 {time} 保存到本地。",
  "editor.draft.unchanged": "草稿已是最新。",
  "editor.draft.restored": "已恢复本地草稿。",
  "editor.draft.discarded": "已保留测试页内容。你开始编辑后才会覆盖已存草稿。",
  "editor.draft.saveError": "无法保存本地草稿：{error}",
  "editor.draft.loadError":
    "无法读取本地草稿：{error}。自动保存已暂停，关闭标签页前请先重试。",
  "editor.draft.restoreTitle": "恢复本地草稿？",
  "editor.draft.restoreBody":
    "本地存有一份保存于 {time} 的草稿。恢复将替换当前内容；保留测试页内容则会在你下次编辑前保留原草稿。",
  "editor.draft.restore": "恢复草稿",
  "editor.draft.useFixture": "保留测试页内容",
  "editor.draft.conflictTitle": "多标签页草稿冲突",
  "editor.draft.conflictLegend": "选择要保留的版本（预览为只读）",
  "editor.draft.conflictBody":
    "当前标签页保存于 {thisTime}，另一标签页保存于 {otherTime}。请选择要保留的版本。",
  "editor.draft.otherActive": "另一标签页仍在编辑此草稿。",
  "editor.draft.otherInactive": "另一标签页已不再活跃，可以安全覆盖。",
  "editor.draft.thisPage": "保留当前标签页",
  "editor.draft.otherPage": "保留另一标签页",
  "editor.draft.keepNewer": "保留较新版本",
  "editor.draft.newerThis": "当前标签页较新。",
  "editor.draft.newerOther": "另一标签页较新。",
  "editor.draft.previewThis": "当前标签页",
  "editor.draft.previewOther": "另一标签页保存的内容",
  "editor.draft.empty": "（空）",
  "editor.draft.applyChoice": "应用",
  "editor.draft.decideLater": "稍后处理",
  "editor.draft.resolve": "解决冲突",
  "editor.draft.retrySave": "重试保存",
  "editor.draft.deferred": "冲突尚未解决，已暂停此草稿的自动保存。",
  "editor.draft.leaseLost":
    "另一标签页已接管此草稿的自动保存。如需从当前页面保存，请点击重试。",
  "editor.draft.remoteChanged":
    "另一标签页更新了此草稿。下次保存时会先询问确认。",
  "editor.draft.conflictResolved": "冲突已解决：{choice}。",
  "editor.draft.conflictStale": "另一标签页的内容又有变动，请查看刷新后的对比。",

  "editor.site.heading": "MonacoAnywhere {version} · {mode} · 站点编辑器",
  "editor.site.ariaLabel":
    "MonacoAnywhere 站点 C++ 编辑器（支持本地草稿恢复）",
  "editor.site.waiting": "正在连接页面编辑器…",
  "editor.site.standardLabel": "C++ 标准",
  "editor.site.standardPlaceholder": "选择标准",
  "editor.site.languageMissing":
    "站点未报告当前语言。语言服务已暂停，编辑与站点同步不受影响。",
  "editor.site.languageUnknown":
    "站点语言“{label}”未对应到受支持的 C++ 标准。语言服务已暂停，编辑与站点同步不受影响。",
  "editor.site.languageUnsupported":
    "站点语言“{label}”为 C++26，暂不支持。语言服务已暂停，编辑与站点同步不受影响。",
  "editor.site.languageFallbackVersion":
    "站点语言“{label}”未标明 C++ 版本。已默认使用 C++23 语言服务，编辑与站点同步不受影响。",
  "editor.site.languageFallbackUnsupported":
    "站点语言“{label}”选择了 C++26，暂不支持。已改用 C++23 语言服务，部分 C++26 特性可能不可用。",
  "editor.site.languageRequested":
    "正在切换站点语言至 {standard}…",
  "editor.site.choiceTitle": "选择编译器选项",
  "editor.site.choiceBody":
    "站点为 {standard} 提供了多个编译器选项，请选择要使用的一项。",
  "editor.site.choiceLegend": "站点编译器选项",
  "editor.site.choiceConfirm": "应用选项",
  "editor.site.choiceSent": "正在应用所选编译器选项…",
  "editor.site.choiceUnavailable": "站点未提供该标准下可用的编译器选项。",
  "editor.site.choiceError": "无法加载站点编译器选项：{error}",
  "editor.site.remoteActiveStatus":
    "当前页面正在使用站点自带的语言服务。如需切换为 MonacoAnywhere，请选择 WASM 或本机 clangd，保存代码后刷新页面。",
  "editor.site.remoteReloadStatus":
    "站点后端选择已保存。请先保存代码，再刷新页面使其生效。",
  "editor.site.remoteUnsupportedStatus":
    "无法安全暂停站点自带语言服务，因此未在此页面启用本地语言服务。编辑与站点同步不受影响。",
  "editor.site.remoteSiteStatus":
    "当前站点设为使用站点自带语言服务。如需使用 MonacoAnywhere 服务，请切换为 WASM 或本机 clangd。",
  "editor.site.scope": "草稿范围：{account} · {problem}（仅存本地）",
  "editor.site.anonymous": "匿名",
  "editor.site.restoreBody":
    "本地存有一份保存于 {time} 的草稿。恢复将替换站点编辑器中的内容；保留站点内容则会在你下次编辑前保留原草稿。",
  "editor.site.useSiteText": "保留站点内容",
  "editor.site.discarded": "已保留站点内容。你开始编辑后才会覆盖已存草稿。",
  "editor.site.textTooLarge":
    "代码超出站点同步大小上限，未能同步到站点编辑器。",
  "editor.site.siteTextChanged":
    "有未同步的更改时，站点编辑器内容发生了变动。已保留你当前的代码，提交前请先核对。",

  "onboarding.pageTitle": "MonacoAnywhere 设置向导",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "设置 MonacoAnywhere",
  "onboarding.intro":
    "选择语言服务后端、准备所需资源，并运行一次补全测试即可完成配置。",
  "onboarding.steps.ariaLabel": "设置步骤",
  "onboarding.steps.backend": "后端",
  "onboarding.steps.resources": "资源",
  "onboarding.steps.validation": "验证",
  "onboarding.steps.complete": "完成",
  "onboarding.choose.title": "选择后端",
  "onboarding.choose.legend": "语言服务后端",
  "onboarding.backend.wasm.title": "WASM clangd",
  "onboarding.backend.wasm.description":
    "直接在浏览器内运行，使用内置 WASM 引擎与可下载的 C++ 工具链数据包。",
  "onboarding.backend.native.title": "本机 clangd",
  "onboarding.backend.native.description":
    "通过单独安装的本机宿主，调用你电脑上的 clangd。",
  "onboarding.choose.hint":
    "请选择要使用的后端，之后也可以随时在选项中更改。",
  "onboarding.resources.title": "准备资源",
  "onboarding.resources.note":
    "若本机已安装匹配的数据包，将直接复用。新下载的文件会在安装前进行完整性校验。",
  "onboarding.resources.wasmBody":
    "下载 C++ 工具链数据包，校验哈希与头文件清单后保存到本地。",
  "onboarding.resources.nativeBody":
    "请使用下方扩展 ID 从 host/dist 安装本机宿主，然后运行检测以确认连接正常。",
  "onboarding.resources.install": "下载并安装工具链数据包",
  "onboarding.resources.recheck": "检查已安装数据包",
  "onboarding.resources.detect": "检测本机宿主",
  "onboarding.resources.nativeCommand": "宿主安装命令",
  "onboarding.resources.wasmNotChecked":
    "未找到匹配的工具链数据包，请先下载安装。",
  "onboarding.resources.nativeNotChecked":
    "尚未检测本机宿主。点击“检测本机宿主”以测试连接。",
  "onboarding.resources.checkingInstalled":
    "正在检查已安装的工具链数据包…",
  "onboarding.resources.installingPreparing": "正在准备下载…",
  "onboarding.resources.installing":
    "正在从镜像 {mirror}/{mirrors} 下载 {pack}：{received} / {total}（{percent}%）…",
  "onboarding.resources.verifying":
    "正在校验 {pack}…",
  "onboarding.resources.installed":
    "工具链数据包 {pack} {version} 已安装（共 {files} 个文件，{bytes}，SHA-256 {sha}…）。",
  "onboarding.resources.installSuccess":
    "已安装 {pack} {version}（{bytes}，共 {files} 个文件，SHA-256 {sha}…）。",
  "onboarding.resources.installRequired":
    "请先安装工具链数据包，再进入验证步骤。",
  "onboarding.resources.allMirrorsFailed":
    "所有镜像均下载失败。请检查网络后重试，或更换后端。",
  "onboarding.resources.checksumMismatch":
    "所有镜像的下载文件均未通过 SHA-256 校验。请重试或更换后端。",
  "onboarding.resources.verificationFailed":
    "工具链数据包校验失败：{error}",
  "onboarding.resources.storageFailed":
    "无法将工具链数据包保存到本地：{error}",
  "onboarding.resources.catalogueFailed":
    "无法读取内置工具链目录：{error}",
  "onboarding.resources.installFailed":
    "工具链数据包安装失败：{error}",
  "onboarding.resources.nativeChecking": "正在连接本机宿主…",
  "onboarding.resources.nativeMissing":
    "未检测到本机宿主：{error}。请安装后重试，或更换后端。",
  "onboarding.resources.nativeEmpty":
    "本机宿主未返回数据。你仍可进入下一步直接测试 clangd 会话。",
  "onboarding.resources.nativeFailed": "本机宿主检测失败：{error}",
  "onboarding.resources.nativeResponded":
    "已连接到本机宿主（{detail}）。点击继续以验证 clangd 会话。",
  "onboarding.resources.chooseBackend": "请先选择后端。",
  "onboarding.validation.title": "验证",
  "onboarding.validation.description":
    "启动所选后端并在示例 C++ 文件上初始化 clangd，随后发送一次 {method} 请求以确认补全可用。",
  "onboarding.validation.check": "运行验证",
  "onboarding.validation.changeBackend": "更换后端",
  "onboarding.validation.readyToCheck":
    "尚未运行。启动 clangd 可能需要几秒钟。",
  "onboarding.validation.stage.starting": "启动后端",
  "onboarding.validation.stage.initializing": "初始化 clangd",
  "onboarding.validation.stage.opening": "打开示例文件",
  "onboarding.validation.stage.completing": "请求补全",
  "onboarding.validation.progress": "正在验证：{stage}…",
  "onboarding.validation.success":
    "验证通过，返回了 {count} 个补全建议。",
  "onboarding.validation.zeroItems":
    "clangd 未返回补全建议。请重试或更换后端。",
  "onboarding.validation.packMissing":
    "尚未安装工具链数据包 {pack} {version}，请先返回“资源”步骤安装。",
  "onboarding.validation.preparationFailed": "验证准备失败：{error}",
  "onboarding.validation.backendFailed": "无法启动 {backend} 后端：{error}",
  "onboarding.validation.failed": "验证失败：{error}",
  "onboarding.validation.markFailed":
    "验证返回了 {count} 个建议，但未能保存配置状态：{error}",
  "onboarding.validation.completeNote":
    "clangd 返回至少一个补全建议后，设置即视为完成。",
  "onboarding.guidance.wasm.title": "WASM 后端",
  "onboarding.guidance.wasm.first":
    "在扩展内运行 WASM clangd，使用经校验的工具链数据包提供标准库头文件。",
  "onboarding.guidance.wasm.second":
    "已安装的同版本数据包会自动复用。验证步骤会启动 clangd 并测试补全。",
  "onboarding.guidance.native.title": "本机后端",
  "onboarding.guidance.native.first":
    "使用当前扩展 ID 从 host/dist 安装本机宿主，并运行检测以确认连接。",
  "onboarding.guidance.native.second":
    "验证步骤会通过本机宿主启动 clangd，确认 C++ 补全正常工作。",
  "onboarding.validation.chooseBackend": "请先选择后端，再运行验证。",
  "onboarding.error.selectBackend": "请先选择一个后端。",
  "onboarding.info.saved":
    "后端选择已保存。完成资源准备与验证后即可生效。",
  "onboarding.error.save": "无法保存后端选择：{error}",
  "onboarding.error.openOptions": "无法打开选项：{error}",
  "onboarding.info.completeStored":
    "之前已完成过设置。如需在此结束向导，请重新运行一次验证。",
  "onboarding.complete.title": "完成设置",
  "onboarding.complete.blocked":
    "请先通过验证，再完成设置。",
  "onboarding.complete.stored":
    "之前已验证通过。请重新运行一次验证以启用“完成设置”。",
  "onboarding.complete.requirementStatus":
    "验证返回至少一个补全建议后，“完成设置”按钮将解锁。",
  "onboarding.complete.requirements":
    "配置状态会跨重启保留；日后更换后端时需要重新验证。",
  "onboarding.complete.success":
    "验证通过，返回了 {count} 个补全建议，配置状态已保存。",
  "onboarding.complete.ready":
    "全部准备就绪。点击“完成设置”打开选项页。",
  "onboarding.complete.finish": "完成设置",
  "onboarding.error.init": "设置页面初始化失败：{error}",

  "options.pageTitle": "MonacoAnywhere 选项",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "MonacoAnywhere 选项",
  "options.intro":
    "管理后端、编辑器外观与编译参数。如需下载工具链数据包或验证后端，请使用设置向导。",
  "options.nav.label": "设置类别",
  "options.back": "返回",
  "options.panel.label": "设置",
  "options.nav.services": "语言服务",
  "options.nav.services.help": "后端与 clangd 路径",
  "options.nav.editor": "编辑器",
  "options.nav.editor.help": "字体、主题与后台暂停",
  "options.nav.appearance": "界面",
  "options.nav.appearance.help": "主题与界面语言",
  "options.nav.advanced": "高级",
  "options.nav.advanced.help": "本机宿主编译选项",
  "options.nav.state": "当前状态",
  "options.nav.state.help": "配置状态与站点设置",
  "options.group.backend": "后端",
  "options.group.local": "本机配置",
  "options.group.editor": "文本编辑器",
  "options.group.behavior": "行为",
  "options.group.theme": "外观",
  "options.group.language": "语言",
  "options.group.compiler": "编译器集成",
  "options.group.setup": "配置",
  "options.group.about": "关于",
  "options.backend.label": "默认后端",
  "options.backend.none": "未选择后端",
  "options.backend.noneShort": "未选择",
  "options.backend.wasm": "WASM clangd",
  "options.backend.wasmShort": "WASM",
  "options.backend.native": "本机 clangd",
  "options.backend.nativeShort": "本机",
  "options.validation.title": "后端验证",
  "options.validation.idle":
    "尚未验证。将启动所选后端并请求一次补全。",
  "options.validation.verified": "已验证，可正常使用。",
  "options.validation.running": "正在验证：{stage}…",
  "options.validation.success": "验证通过，返回了 {count} 个补全建议。",
  "options.validation.chooseBackend": "请先选择并保存后端。",
  "options.validation.unsaved": "请先保存后端选择。",
  "options.validation.noCompletions":
    "clangd 未返回补全建议。请重试，或打开设置向导。",
  "options.validation.packMissing":
    "尚未安装工具链数据包 {pack} {version}，请先在设置向导中安装。",
  "options.validation.failed": "验证失败：{error}",
  "options.validation.run": "验证",
  "options.backend.help":
    "更改后端会清除验证状态，可在此处或设置向导中重新验证。",
  "options.theme.label": "主题",
  "options.theme.system": "跟随系统",
  "options.theme.light": "浅色",
  "options.theme.dark": "深色",
  "options.locale.label": "界面语言",
  "options.locale.auto": "跟随浏览器",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "后台暂停延迟（毫秒）",
  "options.hiddenPause.help": "标签页切至后台后，延迟多久暂停运行中的 WASM 会话。",
  "options.clangdPath.label": "clangd 路径",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "启动本机 clangd 会话时传给本机宿主，此处不会检测路径是否有效。",
  "options.editorFont.label": "编辑器字体",
  "options.editorFont.help":
    "填写 monospace 跟随浏览器默认等宽字体，或输入自定义 CSS 字体栈。",
  "options.editorTheme.label": "编辑器主题",
  "options.queryDriver.label": "query-driver 白名单",
  "options.queryDriver.placeholder": "每行一个 glob，或用逗号分隔",
  "options.queryDriver.help": "仅在本机 clangd 会话启动时生效。",
  "options.extraIncludes.label": "额外头文件目录",
  "options.extraIncludes.placeholder": "每行一个路径，或用逗号分隔",
  "options.extraIncludes.help": "在本机 clangd 会话中作为头文件搜索路径传入。",
  "options.saveShort": "保存",
  "options.openSetup": "打开设置向导",
  "options.error.unsupportedBackend": "不支持的后端选项。",
  "options.error.pauseRange": "暂停延迟必须是 {min} 到 {max} 毫秒之间的整数。",
  "options.info.saved":
    "偏好设置已保存。",
  "options.info.backendChanged":
    "后端设置已保存。请在下方验证以确认新后端。",
  "options.info.themeSaved": "主题已保存并生效。",
  "options.info.localeSaved": "界面语言已保存并生效。",
  "options.error.preferenceSave": "无法保存设置：{error}",
  "options.error.save": "无法保存偏好设置：{error}",
  "options.error.openSetup": "无法打开设置向导：{error}",
  "options.error.init": "选项页面初始化失败：{error}",
  "options.state.none": "尚未选择后端，设置未完成。",
  "options.state.backend":
    "当前后端：{backend} · 已完成验证：{complete}",
  "options.state.siteOverrides": "已单独配置的站点：{count} 个",
  "options.state.overridesHelp": "清除后，这些站点将恢复使用自带的语言服务。",
  "options.resetSites": "重置站点后端选择",
  "options.info.sitesReset": "已清除站点后端选择，刷新已打开的站点页面即可生效。",
  "options.state.note":
    "更改后端会重置验证状态，需在此处或设置向导中重新验证。",
  "options.loading": "正在加载设置…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "{mode} · {version}",
  "popup.statusAria": "状态",
  "popup.state.ready": "已就绪",
  "popup.state.setup": "需要设置",
  "popup.site.label": "当前站点",
  "popup.site.none": "非网页标签",
  "popup.backend.label": "后端",
  "popup.backend.choose": "默认后端",
  "popup.backend.chooseSite": "此 Hydro 站点的后端",
  "popup.backend.none": "未选择后端",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "本机 clangd",
  "popup.backend.nativeShort": "本机",
  "popup.backend.site": "站点语言服务",
  "popup.backend.siteShort": "站点",
  "popup.services.label": "语言服务",
  "popup.services.none": "尚未配置",
  "popup.services.local": "MonacoAnywhere · {backend}",
  "popup.remote.active": "站点 LSP 运行中",
  "popup.remote.suspended": "站点 LSP 已暂停",
  "popup.remote.reload": "需要刷新",
  "popup.remote.unsupported": "站点 LSP 状态未知",
  "popup.remote.none": "未使用站点服务",
  "popup.theme.label": "编辑器主题",
  "popup.registrations.count": "已启用 {count} 个站点",
  "popup.oobe.incomplete":
    "请完成设置以下载工具链数据并验证后端。",
  "popup.oobe.stored":
    "所选后端已验证就绪。",
  "popup.continueSetup": "继续设置",
  "popup.openOptions": "设置",
  "popup.openFixture": "独立编辑器",
  "popup.enableSite": "在 {host} 上启用",
  "popup.error.enableSite": "无法在此站点启用 MonacoAnywhere：{error}",
  "popup.error.openSetup": "无法打开设置向导：{error}",
  "popup.error.save": "无法保存设置：{error}",
  "popup.error.openOptions": "无法打开选项：{error}",
  "popup.error.openFixture": "无法打开独立编辑器：{error}",
  "popup.error.init": "弹出窗口初始化失败：{error}",
  "popup.loading": "正在加载…"
} as const satisfies Record<MessageKey, string>;
