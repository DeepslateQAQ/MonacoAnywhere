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
  "editor.headingSuffix": "测试页",
  "editor.ariaLabel": "MonacoAnywhere C++ 编辑器测试页（支持本机草稿恢复）",
  "editor.status.initial":
    "编辑器已就绪。草稿只保存在本机；C++ 语言服务会使用所选后端启动。",
  "editor.standalone.ready": "空白 C++ 工作区",
  "editor.status.bootstrap":
    "引导构建未随包提供引擎或工具链数据，因此语言服务不可用。编辑与本机草稿仍可使用。",
  "editor.status.production":
    "C++ 语言服务尚未启动。请在设置中选择后端；编辑与本机草稿仍可使用。",
  "editor.status.noCpp":
    "cpp 语言定义未注册，语法高亮不可用；编辑与本机草稿仍可使用。",
  "editor.status.badTheme":
    "无法应用编辑器主题“{theme}”：{error}。已使用系统默认主题。",
  "editor.status.settingsError":
    "无法读取设置：{error}。已使用默认值；请在选项中检查所选后端。",
  "editor.status.lspNotConfigured":
    "请先在设置中选择语言服务后端，以启用 C++ 补全与诊断。",
  "editor.status.lspConnecting": "正在启动 C++ 语言服务并准备工具链头文件…",
  "editor.status.lspReady": "C++ 服务已就绪",
  "editor.status.lspReconnecting":
    "语言服务连接已断开，正在重连（{attempt}/{max}）…",
  "editor.status.lspClosedFinal":
    "语言服务连续关闭：{reason}。你的编辑内容仍然安全；请重新打开编辑器后再试。",
  "editor.status.lspError":
    "C++ 语言服务已停止：{error}。编辑与本机草稿仍可使用。",
  "editor.status.lspPaused":
    "标签页长时间隐藏，WASM 语言服务已暂停。回到前台时会重新启动；代码与草稿保持不变。",
  "editor.status.lspUnavailable":
    "无法读取后端设置：{error}。编辑与本机草稿仍可使用。",
  "editor.status.dataMissing":
    "工具链数据不可用：{error}。编辑与本机草稿仍可使用。",
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

  "editor.site.heading": "MonacoAnywhere {version} · {mode} · 站点编辑器",
  "editor.site.ariaLabel":
    "MonacoAnywhere 站点 C++ 编辑器（支持本机草稿恢复）",
  "editor.site.waiting": "正在等待页面发送站点编辑器上下文…",
  "editor.site.standardLabel": "C++ 标准",
  "editor.site.standardPlaceholder": "选择标准",
  "editor.site.languageMissing":
    "站点未报告已选语言选项。语言服务已关闭；编辑与站点同步仍可使用。",
  "editor.site.languageUnknown":
    "站点语言“{label}”无法映射到受支持的 C++ 标准。语言服务已关闭；编辑与站点同步仍可使用。",
  "editor.site.languageUnsupported":
    "站点语言“{label}”是 C++26，MonacoAnywhere 不支持该标准。语言服务已关闭；编辑与站点同步仍可使用。",
  "editor.site.languageRequested":
    "已向站点请求 {standard}，正在等待站点语言控件应用。",
  "editor.site.choiceTitle": "选择站点编译器选项",
  "editor.site.choiceBody":
    "站点为 {standard} 提供了多个编译器选项。请选择要应用的具体选项；不会自动选择。",
  "editor.site.choiceLegend": "站点编译器选项",
  "editor.site.choiceConfirm": "应用选项",
  "editor.site.choiceSent": "已发送所选站点编译器选项，正在等待站点确认。",
  "editor.site.choiceUnavailable": "站点未提供该标准下可选择的编译器选项。",
  "editor.site.choiceError": "无法显示站点编译器选项：{error}",
  "editor.site.remoteActiveStatus":
    "此页面正在运行站点自带语言服务。MonacoAnywhere 在此不会启动本地语言服务；请为本站点选择 WASM 或本机 clangd，保存代码后重新加载页面以应用选择。",
  "editor.site.remoteReloadStatus":
    "本站点的语言后端选择已保存但尚未生效。请保存代码后重新加载页面。",
  "editor.site.remoteUnsupportedStatus":
    "MonacoAnywhere 无法安全检测或暂停此页面的语言服务，因此本地语言服务在此关闭。编辑与站点同步仍可使用。",
  "editor.site.remoteSiteStatus":
    "本站点已设为使用站点自带语言服务。本地语言服务已关闭；如需使用 MonacoAnywhere 服务，请选择 WASM 或本机 clangd。",
  "editor.site.scope": "草稿范围：{account} · {problem}。仅保存在本机。",
  "editor.site.anonymous": "匿名",
  "editor.site.restoreBody":
    "此站点编辑器在本机存有于 {time} 保存的草稿。恢复将替换本编辑器中的当前站点文本，并发送到站点编辑器；选择站点文本会保留它直到你编辑。任何内容都不会上传。",
  "editor.site.useSiteText": "使用站点文本",
  "editor.site.discarded": "已保留站点文本。只有在你下次编辑后才会替换已存草稿。",
  "editor.site.textTooLarge":
    "编辑器文本超过站点同步上限，未发送到站点编辑器。",
  "editor.site.siteTextChanged":
    "此编辑器有尚未发送的更改时，站点编辑器文本发生了变化。已保留你的编辑器文本；提交前请检查站点编辑器。",

  "onboarding.pageTitle": "MonacoAnywhere 设置",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "设置 MonacoAnywhere",
  "onboarding.intro":
    "此四步向导会依次选择后端、下载并校验资源、运行一次真实测试台补全，之后才完成设置。失败不会自动切换后端。",
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
    "若已安装完全匹配的数据包，将直接复用而不下载。下载在本地安装前会校验长度、SHA-256、清单与头文件树；校验失败不会安装任何内容。",
  "onboarding.resources.wasmBody":
    "从随包目录指定的镜像下载工具链数据包，校验 SHA-256 与解包后的清单，然后保存到本机。此步骤不会启动语言服务。",
  "onboarding.resources.nativeBody":
    "请使用此扩展 ID 从 host/dist 安装本机宿主，然后运行检测。检测发送真实 Native Messaging 请求；验证会另外启动真实 clangd 会话。",
  "onboarding.resources.install": "下载并安装工具链数据包",
  "onboarding.resources.recheck": "检查已安装数据包",
  "onboarding.resources.detect": "检测本机宿主",
  "onboarding.resources.nativeCommand": "宿主安装命令",
  "onboarding.resources.wasmNotChecked":
    "未安装匹配的工具链数据包。请先下载并校验，再继续。",
  "onboarding.resources.nativeNotChecked":
    "尚未检测本机宿主。请选择“检测本机宿主”。验证仍会尝试启动真实 clangd 会话。",
  "onboarding.resources.checkingInstalled":
    "正在检查本机已安装的工具链数据包…",
  "onboarding.resources.installingPreparing": "正在准备工具链下载…",
  "onboarding.resources.installing":
    "正在从镜像 {mirror}/{mirrors} 下载 {pack}：{received} / {total}（{percent}%）…",
  "onboarding.resources.verifying":
    "{pack} 下载完成；安装前正在校验 SHA-256、清单与头文件树…",
  "onboarding.resources.installed":
    "工具链数据包 {pack} {version} 已安装（{files} 个文件；{bytes}；SHA-256 {sha}…）。未启动下载。",
  "onboarding.resources.installSuccess":
    "已安装工具链数据包 {pack} {version}：{bytes}，SHA-256 {sha}…，共 {files} 个文件。",
  "onboarding.resources.installRequired":
    "请先安装并校验工具链数据包，再继续验证。",
  "onboarding.resources.allMirrorsFailed":
    "所有下载镜像均失败；未安装任何内容。请重试、更改后端或检查网络。",
  "onboarding.resources.checksumMismatch":
    "所有可达镜像提供的字节均未通过 SHA-256 校验；未安装任何内容。请重试或更改后端。",
  "onboarding.resources.verificationFailed":
    "工具链数据包校验失败；未安装任何内容：{error}",
  "onboarding.resources.storageFailed":
    "已校验的工具链数据包无法保存到本机：{error}",
  "onboarding.resources.catalogueFailed":
    "随包工具链目录不可用：{error}",
  "onboarding.resources.installFailed":
    "工具链数据包安装失败：{error}",
  "onboarding.resources.nativeChecking": "正在联系本机宿主…",
  "onboarding.resources.nativeMissing":
    "未检测到本机宿主：{error}。请安装后重试，或更改后端。",
  "onboarding.resources.nativeEmpty":
    "本机宿主进程未返回数据，检测不完整。验证仍会尝试真实会话。",
  "onboarding.resources.nativeFailed": "本机宿主检测失败：{error}",
  "onboarding.resources.nativeResponded":
    "本机宿主已有响应（{detail}）。检测成功；请继续验证以启动真实 clangd 会话。",
  "onboarding.resources.chooseBackend": "请先选择后端再检查资源。",
  "onboarding.validation.title": "验证",
  "onboarding.validation.description":
    "验证会通过 offscreen 宿主启动所选后端、初始化 clangd、打开内置 C++ 测试台，并发送一次真实的 {method} 请求。只有返回至少一个条目才会完成设置。",
  "onboarding.validation.check": "运行真实测试台验证",
  "onboarding.validation.changeBackend": "更改后端",
  "onboarding.validation.readyToCheck":
    "尚未运行。此操作会启动真实语言服务，可能需要数秒。",
  "onboarding.validation.stage.starting": "启动 offscreen 后端",
  "onboarding.validation.stage.initializing": "初始化 clangd",
  "onboarding.validation.stage.opening": "打开测试台文档",
  "onboarding.validation.stage.completing": "请求补全",
  "onboarding.validation.progress": "验证进行中：{stage}…",
  "onboarding.validation.success":
    "验证成功：返回 {count} 个补全条目。onboardingComplete 已保存。",
  "onboarding.validation.zeroItems":
    "clangd 返回 0 个补全条目；未写入 onboardingComplete。请重试或更改后端。",
  "onboarding.validation.packMissing":
    "工具链数据包 {pack} {version} 未安装。请返回“资源”步骤安装后再验证。",
  "onboarding.validation.preparationFailed": "验证准备失败：{error}",
  "onboarding.validation.backendFailed": "无法启动 {backend} 后端：{error}",
  "onboarding.validation.failed": "验证失败：{error}",
  "onboarding.validation.markFailed":
    "验证返回 {count} 个条目，但无法保存完成状态：{error}",
  "onboarding.validation.completeNote":
    "只有真实测试台补全返回正数才能写入 onboardingComplete。失败会保留所选后端，绝不自动切换。",
  "onboarding.guidance.wasm.title": "WASM 后端",
  "onboarding.guidance.wasm.first":
    "WASM clangd 引擎在扩展内运行。工具链数据包从随包目录的镜像下载，并在安装前校验。",
  "onboarding.guidance.wasm.second":
    "相同版本的数据包会直接复用，不会重复下载。验证会启动真实的 offscreen clangd 会话并请求测试台补全。",
  "onboarding.guidance.native.title": "本机后端",
  "onboarding.guidance.native.first":
    "请使用此扩展 ID 从 host/dist 安装本机宿主。“检测本机宿主”按钮会发送真实 Native Messaging 请求。",
  "onboarding.guidance.native.second":
    "验证随后通过本机宿主启动真实 clangd 会话。验证失败会保留此后端选择。",
  "onboarding.validation.chooseBackend": "请先选择后端。验证尚无法运行。",
  "onboarding.error.selectBackend": "继续之前请选择一个后端。默认不预选任何后端。",
  "onboarding.info.saved":
    "后端选择已保存。只有资源准备完成且验证成功后，设置才算完成。",
  "onboarding.error.save": "无法保存后端选择：{error}",
  "onboarding.error.openOptions": "无法打开选项：{error}",
  "onboarding.info.completeStored":
    "onboardingComplete=true 来自先前成功的验证。请在本次会话中重新验证以启用“完成设置”。",
  "onboarding.complete.title": "完成设置",
  "onboarding.complete.blocked":
    "设置尚未完成。请先成功运行真实测试台验证。",
  "onboarding.complete.stored":
    "onboardingComplete=true 来自先前成功的验证。请在本次会话中重新验证以启用“完成设置”。",
  "onboarding.complete.requirementStatus":
    "只有真实测试台补全返回至少一个条目后，“完成设置”才可用。",
  "onboarding.complete.requirements":
    "onboardingComplete 集中保存并可跨重启保留。更改后端会清除它，直到新后端重新验证成功。",
  "onboarding.complete.success":
    "验证成功，返回 {count} 个补全条目。onboardingComplete 已集中保存。",
  "onboarding.complete.ready":
    "设置完成。“完成设置”会打开选项；验证失败从未更改所选后端。",
  "onboarding.complete.finish": "完成设置",
  "onboarding.error.init": "设置页面初始化失败：{error}",

  "options.pageTitle": "MonacoAnywhere 选项",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "选项",
  "options.intro":
    "偏好集中保存在 settings:v1，标注为即时的项目会立即应用。设置向导会下载并校验工具链数据包，并运行真实测试台验证；本页不执行验证。",
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
  "options.hiddenPause.help": "引擎启动后用于 WASM 会话。",
  "options.clangdPath.label": "clangd 路径",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "启动本机会话时传给本机宿主；本页不会探测。",
  "options.editorFont.label": "编辑器字体",
  "options.editorFont.help":
    "填写 monospace 会跟随浏览器的等宽字体设置，也可以填写自定义 CSS 字体栈。",
  "options.editorTheme.label": "编辑器主题",
  "options.advanced.legend": "高级",
  "options.queryDriver.label": "query-driver 白名单",
  "options.queryDriver.placeholder": "每行一个 glob，或用逗号分隔",
  "options.queryDriver.help": "仅用于本机宿主配置；本机会话启动时应用。",
  "options.extraIncludes.label": "额外头文件目录",
  "options.extraIncludes.placeholder": "每行一个路径，或用逗号分隔",
  "options.extraIncludes.help": "本机会话中作为独立的编译器参数传入。",
  "options.save": "保存偏好",
  "options.openSetup": "打开设置向导",
  "options.error.unsupportedBackend": "不支持的后端选择。",
  "options.error.pauseRange": "暂停延迟必须是介于 {min} 与 {max} 毫秒之间的整数。",
  "options.info.saved":
    "偏好已集中保存。本页不会运行后端验证。",
  "options.info.backendChanged":
    "后端偏好已保存。由于后端选择已更改，之前的设置完成状态已清除；请重新完成设置。",
  "options.info.themeSaved": "主题已保存并应用。",
  "options.info.localeSaved": "界面语言已保存并应用。",
  "options.error.preferenceSave": "无法保存此项偏好：{error}",
  "options.error.save": "无法保存偏好：{error}",
  "options.error.openSetup": "无法打开设置向导：{error}",
  "options.error.init": "选项页面初始化失败：{error}",
  "options.state.title": "当前状态",
  "options.state.none": "未选择后端。设置未完成。",
  "options.state.backend":
    "后端偏好：{backend}。onboardingComplete={complete}。",
  "options.state.siteOverrides": "按站点覆盖的后端：{count} 个。",
  "options.resetSites": "清除站点后端选择",
  "options.info.sitesReset": "已清除站点后端选择。刷新已打开的站点页面即可恢复站点服务。",
  "options.state.note":
    "只有设置向导中的真实测试台验证成功才会写入 onboardingComplete；更改后端选择会清除它。",
  "options.loading": "正在加载偏好…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "{mode} · {version}",
  "popup.statusAria": "状态",
  "popup.state.ready": "已就绪",
  "popup.state.setup": "需要设置",
  "popup.site.label": "当前站点",
  "popup.site.none": "不在网页上",
  "popup.backend.label": "后端",
  "popup.backend.choose": "默认后端",
  "popup.backend.chooseSite": "本站点后端",
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
    "设置未完成。请完成设置以下载工具链数据并验证所选后端。",
  "popup.oobe.stored":
    "所选后端已完成验证。",
  "popup.continueSetup": "继续设置",
  "popup.openOptions": "设置",
  "popup.openFixture": "独立编辑器",
  "popup.enableSite": "在 {host} 上启用",
  "popup.error.enableSite": "无法在此站点启用 MonacoAnywhere：{error}",
  "popup.error.openSetup": "无法打开设置向导：{error}",
  "popup.error.save": "无法保存偏好：{error}",
  "popup.error.openOptions": "无法打开选项：{error}",
  "popup.error.openFixture": "无法打开测试页：{error}",
  "popup.error.init": "弹出窗口初始化失败：{error}",
  "popup.loading": "正在加载状态…"
} as const satisfies Record<MessageKey, string>;
