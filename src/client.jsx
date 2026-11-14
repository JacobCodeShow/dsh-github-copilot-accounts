// client 半区：浏览器侧 cordis 插件。通过 settings.section 插槽注册
// 「Copilot 账号」页（order 11，紧挨 Models 的 order 10），样式对齐 GitHub
// Copilot desktop 的 Accounts 设置页：账号卡片列表（头像 / Default 徽标 /
// … 菜单 / Plan + AI credits 进度条）+「Add account」下拉两种登录入口
// （GitHub.com / GitHub Enterprise Cloud）。
// 文案走 locale 服务（en/zh 词典，随系统语言切换）；
// Settings navigation uses published settings.section metadata and host icon.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { createAvatarRecovery } from "./avatar-recovery.mjs";
import { avatarImageCache } from "./avatar-cache-scope.mjs";
import { accountLabel, accountQuotaRemaining, combinedAccountUsage, createSessionBadgeController, deriveSessionBadgeState, sessionBadgeErrorKey } from "./session-badge-state.mjs";
import { utcMonthProgress } from "./usage-month.mjs";

export const name = "copilot-auth-ui";
export const inject = ["slots", "locale"];

const DICTS = {
  en: {
    nav: "Copilot Accounts",
    title: "Accounts",
    intro: "Projects use the default account for GitHub Copilot unless changed here.",
    addAccount: "Add account",
    optGithub: "GitHub.com",
    optGithubDesc: "Personal and enterprise accounts",
    optGhe: "GitHub Enterprise Cloud",
    optGheDesc: "Accounts on your company's ghe.com domain",
    domainLabel: "Company ghe.com domain",
    domainPlaceholder: "company.ghe.com",
    continue: "Continue",
    cancel: "Cancel",
    defaultBadge: "Default",
    setDefault: "Set as default",
    signOut: "Remove account",
    updateAuth: "Update authorization",
    refreshModels: "Refresh models",
    refreshModelsFailed: "Model refresh failed. Try again later.",
    managePlan: "Manage plan",
    plan: "Plan",
    credits: "AI credits (resets monthly)",
    creditsWithReset: "AI credits (resets monthly, next reset {date})",
    creditsNote: "AI credits are consumed based on model and token usage.",
    combinedUsed: "Combined used",
    combinedUsageHint: "Sum of account percentages, not a weighted credit balance. Organization accounts may share a billing pool.",
    usageMonth: "{month} UTC · {elapsed} days elapsed · {remaining} days left",
    usageCursor: "Used {used}% · UTC month elapsed {time}%",
    usageValue: "Used {used}%",
    resetsOn: "Resets on",
    unlimited: "Unlimited quota",
    noAccounts: "No connected accounts yet. Use “Add account” to sign in.",
    loading: "…",
    signingIn: "Signing in to",
    signingInDone: "Signed in",
    codeHint: "Open the link below and enter this code to finish signing in:",
    copy: "Copy",
    copied: "Copied ✓",
    unknown: "Unknown error",
    usageFailed: "Usage unavailable",
    legacyAccount: "GitHub Copilot account",
    menu: "More actions",
    authFailed: "Authorization failed",
    authFailedDesc: "Sign in to {target} using a device code.",
    tryAgain: "Try again",
    errorNetwork: "Network connection failed. Please check your network settings and try again.",
    errorTimeout: "The request timed out. Please try again.",
    errorCancelled: "Sign-in was cancelled.",
    errorDomainMismatch: "The device code link did not match the enterprise domain. Please verify the domain and try again.",
    errorDefault: "Sign-in failed. Please try again.",
    cancelSignIn: "Cancel sign-in",
    signInTimeout: "Sign-in timed out after 5 minutes of inactivity. Please try again.",
    addGithubTitle: "Add GitHub account",
    addGithubDesc: "Authorize with GitHub.com using a device code.",
    addGheDesc: "Authorize with {domain} using a device code.",
    stepCopied: "Code copied to clipboard",
    stepOpened: "Opened {target}",
    stepWaiting: "Waiting for authorization…",
    openSite: "Open {target}",
    copyLink: "Copy link",
    badgeNotSignedIn: "Not signed in",
    badgeClickToSignIn: "Click to sign in",
    badgeSwitchAccount: "Switch account",
    badgeSwitching: "Switching…",
    badgeUsage: "Usage",
    badgeUsed: "used",
    badgeResets: "resets",
    badgeQuotaRemaining: "Quota left",
    badgeQuotaPrefix: "Left",
    badgeSessionAccounts: "Accounts for this Session",
    badgeFollowingGlobal: "Following global default",
    badgeSessionBound: "Bound to this Session",
    badgeNotInUse: "Copilot not in use",
    badgeUnavailable: "Accounts unavailable",
    badgeBoundUnavailable: "Bound account unavailable",
    badgeNoDefault: "No global default account",
    badgeUnknownQuota: "Quota unavailable",
    badgeUnmanaged: "Unmanaged credentials; account identity is unknown",
    badgeUseSession: "Use for this Session",
    badgeFollowGlobal: "Follow global default",
    badgeSetGlobalDefault: "Set global default",
    badgeGlobalDefault: "Global default",
    badgeGlobalHint: "Affects Sessions following the global default, not independently bound Sessions",
    badgeRefresh: "Refresh",
    badgeRunningHint: "Session running. Wait until it is idle to change its account.",
    badgeHistoryHint: "Subsequent requests, including this conversation's existing history, are sent through the selected account and service.",
    badgeRowUnavailable: "Unavailable",
    badgeRouteUnavailable: "Session route unavailable",
    badgeFailureTitle: "Request continuation failed",
    badgeFailureBody: "Rebuildable request state was reset; chat history is preserved. Review the error before trying again.",
    badgeClose: "Close",
    badgeErrorOwner: "Only the Host owner can manage Copilot accounts.",
    badgeErrorForbidden: "Access to this Session was denied.",
    badgeErrorBusy: "Wait until this Session is idle before changing its account.",
    badgeErrorRestart: "Restart DSH to apply compaction policy for this account.",
    badgeErrorInactive: "Select a Copilot model before binding an account.",
    badgeErrorStale: "The Session, model or Host changed. Refresh account choices.",
    badgeErrorAccount: "The selected account is no longer available.",
    badgeErrorModel: "This account does not support the current model or reasoning controls.",
    badgeErrorUnavailable: "The Session account service is unavailable on this Host.",
    badgeErrorCancelled: "The account request was cancelled.",
    badgeErrorRequest: "The account operation failed. Refresh choices before trying again.",
  },
  zh: {
    nav: "Copilot 账号",
    title: "账号",
    intro: "对话默认使用标记为默认的 GitHub Copilot 账号，可在此切换。",
    addAccount: "添加账号",
    optGithub: "GitHub.com",
    optGithubDesc: "个人与企业组织账号",
    optGhe: "GitHub Enterprise Cloud",
    optGheDesc: "贵公司 ghe.com 域名下的账号",
    domainLabel: "公司 ghe.com 域名",
    domainPlaceholder: "company.ghe.com",
    continue: "继续",
    cancel: "取消",
    defaultBadge: "默认",
    setDefault: "设为默认",
    signOut: "移除账号",
    updateAuth: "更新授权",
    refreshModels: "刷新模型",
    refreshModelsFailed: "模型刷新失败，请稍后重试。",
    managePlan: "管理套餐",
    plan: "套餐",
    credits: "AI 额度（按月重置）",
    creditsWithReset: "AI 额度（按月重置，下次重置日期 {date}）",
    creditsNote: "AI 额度消耗取决于模型与 token 用量。",
    combinedUsed: "合计已用",
    combinedUsageHint: "按各账号百分比相加，并非额度加权值；组织账号可能共用计费池。",
    usageMonth: "UTC {month} · 已过 {elapsed} 天 · 还剩 {remaining} 天",
    usageCursor: "额度已用 {used}% · UTC 本月已过 {time}%",
    usageValue: "额度已用 {used}%",
    resetsOn: "重置日期",
    unlimited: "不限量",
    noAccounts: "还没有已登录账号。点「添加账号」开始登录。",
    loading: "…",
    signingIn: "正在登录",
    signingInDone: "已登录",
    codeHint: "在浏览器打开下面的链接，输入这串代码完成授权：",
    copy: "复制",
    copied: "已复制 ✓",
    unknown: "未知错误",
    usageFailed: "用量不可用",
    legacyAccount: "GitHub Copilot 账号",
    menu: "更多操作",
    authFailed: "授权失败",
    authFailedDesc: "使用设备码授权登录 {target}。",
    tryAgain: "重试",
    errorNetwork: "网络连接失败，请检查网络设置后重试。",
    errorTimeout: "请求超时，请重试。",
    errorCancelled: "登录已取消。",
    errorDomainMismatch: "设备码链接与企业域名不匹配，请检查域名后重试。",
    errorDefault: "登录失败，请重试。",
    cancelSignIn: "取消登录",
    signInTimeout: "登录超时（5 分钟无操作），请重试。",
    addGithubTitle: "添加 GitHub 账号",
    addGithubDesc: "使用设备码授权登录 GitHub.com。",
    addGheDesc: "使用设备码授权登录 {domain}。",
    stepCopied: "代码已复制到剪贴板",
    stepOpened: "已打开 {target}",
    stepWaiting: "等待授权中…",
    openSite: "打开 {target}",
    copyLink: "复制链接",
    badgeNotSignedIn: "未登录",
    badgeClickToSignIn: "点击登录",
    badgeSwitchAccount: "切换账号",
    badgeSwitching: "切换中…",
    badgeUsage: "额度",
    badgeUsed: "已使用",
    badgeResets: "重置",
    badgeQuotaRemaining: "剩余额度",
    badgeQuotaPrefix: "余",
    badgeSessionAccounts: "当前会话的账号",
    badgeFollowingGlobal: "跟随全局默认",
    badgeSessionBound: "已绑定当前会话",
    badgeNotInUse: "当前未使用 Copilot",
    badgeUnavailable: "账号服务不可用",
    badgeBoundUnavailable: "绑定账号不可用",
    badgeNoDefault: "尚无全局默认账号",
    badgeUnknownQuota: "额度不可用",
    badgeUnmanaged: "未托管凭据，账号身份未知",
    badgeUseSession: "用于当前会话",
    badgeFollowGlobal: "跟随全局默认",
    badgeSetGlobalDefault: "设为全局默认",
    badgeGlobalDefault: "全局默认",
    badgeGlobalHint: "影响跟随全局默认的会话，不改变已独立绑定的会话",
    badgeRefresh: "刷新",
    badgeRunningHint: "会话正在运行，请等待空闲后再更改绑定账号。",
    badgeHistoryHint: "切换后，后续请求（包括当前对话的已有历史）会通过所选账号及其服务发送。",
    badgeRowUnavailable: "不可用",
    badgeRouteUnavailable: "会话路由不可用",
    badgeFailureTitle: "请求续接失败",
    badgeFailureBody: "已重置可重建的请求状态，聊天记录保留。请查看错误后重试。",
    badgeClose: "关闭",
    badgeErrorOwner: "只有此 Host 的所有者可以管理 Copilot 账号。",
    badgeErrorForbidden: "无权访问当前会话。",
    badgeErrorBusy: "请等待当前会话空闲后再更改账号。",
    badgeErrorRestart: "请重启 DSH，以加载此账号的压缩策略。",
    badgeErrorInactive: "请先选择 Copilot 模型，再绑定账号。",
    badgeErrorStale: "会话、模型或 Host 已变化，请刷新账号列表。",
    badgeErrorAccount: "所选账号已不可用。",
    badgeErrorModel: "该账号不支持当前模型或推理设置。",
    badgeErrorUnavailable: "此 Host 的会话账号服务不可用。",
    badgeErrorCancelled: "账号请求已取消。",
    badgeErrorRequest: "账号操作失败，请刷新列表后再重试。",
  },
};

const NAV_TEXTS = Object.keys(DICTS).map((locale) => DICTS[locale].nav);

// 原始错误 → 用户友好文案。技术细节（fetch failed/timeout/abort）翻译成
// 可理解的网络/超时/取消语义；含中文的 host mismatch 错误用专门文案。
function friendlyError(raw, t) {
  const msg = String(raw ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("network")) {
    return t("errorNetwork");
  }
  if (lower.includes("unexpected token") || lower.includes("is not valid json")) {
    return t("errorNetwork");
  }
  if (lower.includes("timeout") || lower.includes("abort")) {
    return t("errorTimeout");
  }
  if (lower.includes("取消")) {
    return t("errorCancelled");
  }
  if (lower.includes("企业域名未生效") || lower.includes("domain")) {
    return t("errorDomainMismatch");
  }
  return `${t("errorDefault")} (${msg})`;
}

// octicons copilot-16（MIT，github/primer）——单色 currentColor，随主题变色
const COPILOT_ICON_SVG =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex:none">' +
  '<path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/>' +
  '<path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>';

// octicons plus-16（MIT，github/primer）——Add account 按钮左侧图标
const PLUS_SVG =
  '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex:none;margin-right:6px;vertical-align:middle">' +
  '<path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>';

// octicons check-16（MIT，github/primer）——状态列表已完成步骤
const CHECK_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;color:#2ea44f">' +
  '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';

// octicons globe-16（MIT，github/primer）——状态列表"已打开"步骤
const GLOBE_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;opacity:0.6">' +
  '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm5.93-4.26a7.3 7.3 0 0 0-.52.8c-.35.65-.66 1.44-.85 2.34h2.4l.7-2.51a4.53 4.53 0 0 0-1.73-.63Zm2.8-.31-.52 1.87h2.15A6.52 6.52 0 0 0 8 1.55c-.61 0-1.2.09-1.77.25l.7 2.51h2.4c.16-.66.27-1.34.32-2.04a6.53 6.53 0 0 0-1.42-.25Zm-4.86 8.32c.19.9.5 1.69.85 2.34.16.3.34.56.52.8a4.53 4.53 0 0 0 1.73-.63l-.7-2.51h-2.4Zm5.66 2.51c.35-.65.66-1.44.85-2.34.17-.86.26-1.77.26-2.71h-2.4l-.7 2.51c.61.36 1.27.61 1.99.74.01.6.01 1.2 0 1.8Z"/></svg>';

// 旋转加载动画（CSS @keyframes spin）
const SPINNER_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex:none;animation:copilot-spin 0.8s linear infinite">' +
  '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28 12" stroke-linecap="round" opacity="0.6"/></svg>';

// 内联 keyframes（注入一次，避免多次嵌入）
const SPINNER_STYLE = '<style>@keyframes copilot-spin{to{transform:rotate(360deg)}}</style>';

// octicons chevron-down-16（MIT，github/primer）——替代字符 ⌄，风格统一
const CHEVRON_DOWN_SVG =
  '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex:none;margin-left:4px;vertical-align:middle">' +
  '<path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"/></svg>';

const styles = {
  section: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 12, fontFamily: "inherit" },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px" },
  intro: { margin: 0, fontSize: 14, lineHeight: "22px", opacity: 0.75 },
  button: { height: 32, padding: "0 14px", fontSize: 14, borderRadius: 16, border: "none",
    cursor: "pointer", fontFamily: "inherit" },
  primary: { background: "#4c6ef5", color: "#fff" },
  secondary: { background: "transparent", color: "inherit", border: "1px solid currentColor", opacity: 0.8 },
  addButton: { height: 32, padding: "0 14px", fontSize: 14, borderRadius: 16, cursor: "pointer",
    fontFamily: "inherit", background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.45)" },
  card: { border: "1px solid rgba(128,128,128,0.35)", borderRadius: 12, padding: "12px 14px",
    display: "flex", flexDirection: "column", gap: 10 },
  cardTop: { display: "flex", alignItems: "center", gap: 12 },
  avatar: { borderRadius: "50%", flex: "none", objectFit: "cover", background: "rgba(128,128,128,0.25)" },
  avatarFallback: { borderRadius: "50%", flex: "none", display: "flex", alignItems: "center",
    justifyContent: "center", background: "rgba(128,128,128,0.25)", color: "inherit", fontWeight: 600 },
  who: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  nameRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { flex: "none", fontSize: 12, lineHeight: "18px", padding: "0 8px", borderRadius: 9,
    background: "rgba(128,128,128,0.18)" },
  sub: { margin: 0, fontSize: 13, lineHeight: "20px", opacity: 0.7 },
  dots: { flex: "none", width: 32, height: 32, borderRadius: "50%", border: "none", background: "transparent",
    color: "inherit", fontSize: 16, cursor: "pointer", opacity: 0.75 },
  menu: { position: "absolute", right: 0, top: 36, zIndex: 10, minWidth: 200, padding: 4,
    background: "var(--background, #fff)", color: "var(--foreground, #1a1a1a)",
    border: "1px solid rgba(128,128,128,0.4)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    display: "flex", flexDirection: "column", gap: 2 },
  menuItem: { display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 14,
    border: "none", borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer",
    fontFamily: "inherit" },
  menuItemDisabled: { opacity: 0.45, cursor: "default" },
  menuItemDanger: { color: "#e03131" },
  backdrop: { position: "fixed", inset: 0, zIndex: 9, background: "transparent" },
  menuDesc: { fontSize: 12, lineHeight: "18px", opacity: 0.7, marginTop: 2 },
  planBlock: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 4,
    borderTop: "1px solid rgba(128,128,128,0.25)" },
  planTitle: { fontSize: 13, lineHeight: "20px", opacity: 0.7 },
  planValue: { fontSize: 14, lineHeight: "22px", fontWeight: 500 },
  creditsRow: { display: "flex", alignItems: "center", justifyContent: "space-between",
    fontSize: 13, lineHeight: "20px" },
  barTrack: { height: 6, borderRadius: 3, background: "rgba(128,128,128,0.25)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, background: "#4c6ef5" },
  muted: { margin: 0, fontSize: 12, lineHeight: "18px", opacity: 0.6 },
  codeHint: { margin: 0, fontSize: 13, lineHeight: "20px", opacity: 0.85 },
  codeRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  code: { fontSize: 24, fontWeight: 700, letterSpacing: 2, fontVariantNumeric: "tabular-nums" },
  link: { fontSize: 13, color: "#4c6ef5" },
  error: { margin: 0, fontSize: 13, lineHeight: "20px", color: "#e03131" },
  // 错误卡片（参考 GitHub Copilot desktop Authorization failed 样式）
  errorCard: { border: "1px solid rgba(128,128,128,0.35)", borderRadius: 12, padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: 14 },
  errorCardTitle: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: "24px" },
  errorCardDesc: { margin: 0, fontSize: 14, lineHeight: "22px", opacity: 0.7 },
  alertBox: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
    borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA",
    color: "#991B1B", fontSize: 13, lineHeight: "20px" },
  alertIcon: { flex: "none", width: 16, height: 16, borderRadius: "50%",
    background: "#DC2626", color: "#fff", display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 11, fontWeight: 700, marginTop: 2 },
  errorActions: { display: "flex", alignItems: "center", gap: 10 },
  input: { flex: 1, minWidth: 180, height: 32, padding: "0 10px", fontSize: 14, borderRadius: 8,
    border: "1px solid rgba(128,128,128,0.45)", background: "transparent", color: "inherit",
    fontFamily: "inherit" },
};

// Both avatar views use the same one-shot profile recovery. URL changes reset
// failed state; the returned URL is retried unchanged, including its signature.
function useAvatarRecovery(id, src, onRecovered, requestProfile, scopeKey, isCurrent) {
  const controllerRef = useRef(null);
  if (controllerRef.current === null) controllerRef.current = createAvatarRecovery();
  const controller = controllerRef.current;
  controller.configure(id, src, scopeKey !== undefined || requestProfile !== undefined ? { scopeKey, requestProfile, isCurrent } : undefined);
  const callbackRef = useRef(onRecovered);
  callbackRef.current = onRecovered;
  const [, rerender] = useState(0);
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => rerender((value) => value + 1));
    controller.mount();
    // A cached image can fail before the passive effect subscribes. Synchronize
    // the current snapshot once, including any error/recovery in that gap.
    rerender((value) => value + 1);
    return () => { unsubscribe(); controller.unmount(); };
  }, [controller]);
  const state = controller.snapshot();
  return { ...state, onError: () => { void controller.fail(state.revision, (nextSource) => callbackRef.current?.(nextSource)); } };
}

// Loading failures keep the initial-letter fallback while one refresh is pending.
function Avatar({ id, src, name, size = 36, onRecovered }) {
  const image = useAvatarRecovery(id, src, onRecovered);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (!image.source || image.failed) {
    return (
      <div style={{ ...styles.avatarFallback, width: size, height: size, fontSize: Math.round(size * 0.45) }}>
        {initial}
      </div>
    );
  }
  return (
    <img key={image.revision} src={image.source} alt="" width={size} height={size} style={styles.avatar}
      referrerPolicy="no-referrer" onError={image.onError} />
  );
}

function useUsageClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return now;
}
function UsageMonthSummary({ now, t, menu = false }) {
  const month = utcMonthProgress(now), fraction = Math.min(100, Math.max(0, month.elapsedPercent));
  const label = t("usageMonth").replace("{month}", month.key).replace("{elapsed}", month.elapsedDays.toFixed(1)).replace("{remaining}", month.remainingDays.toFixed(1));
  return <div data-usage-month title={`${month.start} — ${month.end}`} style={{ ...styles.muted, padding: menu ? "4px 12px 8px" : "0 0 10px" }}>
    <div>{label}</div>
    <div data-usage-legend style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#4c6ef5" }} />{t("badgeUsed")}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i aria-hidden="true" style={{ width: 7, height: 7, background: "#d9a441", transform: "rotate(45deg)" }} />UTC</span>
      <div data-month-track role="img" aria-label={`UTC ${month.elapsedPercent.toFixed(1)}%`} style={{ position: "relative", flex: 1, maxWidth: 120, height: 4, borderRadius: 2, background: "rgba(128,128,128,0.25)" }}>
        <span data-month-marker style={{ position: "absolute", top: "50%", left: `${fraction}%`, width: 8, height: 8, background: "#d9a441", border: "1px solid var(--dsh-bg, #fff)", transform: "translate(-50%, -50%) rotate(45deg)" }} />
      </div>
    </div>
  </div>;
}
function UsageProgress({ percent, now, t }) {
  const month = utcMonthProgress(now);
  const used = Number.isFinite(percent) ? percent : null;
  const bounded = (value) => Math.min(100, Math.max(0, value));
  const title = t("usageCursor").replace("{used}", used === null ? "—" : used.toFixed(1)).replace("{time}", month.elapsedPercent.toFixed(1));
  const base = { position: "absolute", top: "50%", border: "1px solid var(--dsh-bg, #fff)", transform: "translate(-50%, -50%)" };
  return <div data-usage-track role="img" aria-label={title} title={title} style={{ ...styles.barTrack, position: "relative", overflow: "visible" }}>
    {used !== null && <><div style={{ ...styles.barFill, width: `${bounded(used)}%`, borderRadius: "inherit", opacity: 0.55 }} />
      <span data-usage-marker style={{ ...base, left: `${bounded(used)}%`, width: 9, height: 9, borderRadius: "50%", background: "#4c6ef5", zIndex: 3 }} /></>}
    <span data-month-marker title={`UTC ${new Date(now).toISOString().slice(0, 10)} · ${month.elapsedPercent.toFixed(1)}%`}
      style={{ ...base, left: `${bounded(month.elapsedPercent)}%`, width: 8, height: 8, borderRadius: 0, background: "#d9a441", transform: "translate(-50%, -50%) rotate(45deg)", zIndex: 2 }} />
  </div>;
}

// Plan + AI credits 块：plan / 进度条 / 重置日期全部缺字段即隐藏对应元素。
function UsageBlock({ t, plan, usage, usageError, now }) {
  if (usageError) {
    return <p style={styles.muted}>{t("usageFailed")}：{usageError}</p>;
  }
  if (!plan && !usage) return null;
  const percent = usage?.unlimited ? undefined : usage?.percentUsed;
  const knownPercent = Number.isFinite(percent);
  const hasReset = typeof usage?.resets === "string" && usage.resets !== "";
  const creditTitle = hasReset ? t("creditsWithReset").replace("{date}", usage.resets) : t("credits");
  return (
    <div style={styles.planBlock}>
      {plan !== undefined && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={styles.planTitle}>{t("plan")}</span>
          <span style={styles.planValue}>{plan}</span>
        </div>
      )}
      {(knownPercent || usage?.unlimited === true || hasReset) && (
        <div style={{ ...styles.creditsRow, gap: 12 }}>
          <span>{creditTitle}</span>
          {usage?.unlimited === true ? <span title={t("unlimited")} style={{ flex: "none" }}>∞</span>
            : knownPercent && <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>{Math.round(Math.max(0, Math.min(100, percent)))}%</span>}
        </div>
      )}
      {knownPercent && <UsageProgress percent={percent} now={now} t={t} />}
    </div>
  );
}

function CombinedUsage({ accounts, t, menu = false }) {
  const combined = combinedAccountUsage(accounts);
  if (!combined.visible) return null;
  const used = combined.used === null ? "—" : `${combined.used}%`;
  const capacity = combined.capacity === null ? "∞" : `${combined.capacity}%`;
  return <div data-combined-usage title={t("combinedUsageHint")} aria-description={t("combinedUsageHint")}
    style={{ padding: menu ? "8px 12px" : "0 0 10px", fontSize: 13, fontWeight: 500,
      fontVariantNumeric: "tabular-nums", borderBottom: menu ? "1px solid rgba(128,128,128,0.15)" : undefined }}>
    {t("combinedUsed")} {used} / {capacity}
  </div>;
}

function AccountCard({ t, account, now, busy, menuOpen, onToggleMenu, onActivate, onLogout, onUpdateAuth, onRefreshModels, onManagePlan, onAvatarRecovered }) {
  const title = account.name ?? account.login ?? t("legacyAccount");
  return (
    <div style={styles.card}>
      <div style={styles.cardTop}>
        <Avatar id={account.id} src={account.avatarUrl} name={account.name ?? account.login} onRecovered={onAvatarRecovered} />
        <div style={styles.who}>
          <div style={styles.nameRow}>
            <span style={styles.name}>{title}</span>
            {account.active && <span style={styles.badge}>{t("defaultBadge")}</span>}
          </div>
          <p style={styles.sub}>
            {[account.login, account.domain].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ position: "relative", flex: "none" }}>
          <button type="button" style={styles.dots} aria-label={t("menu")} onClick={onToggleMenu}>…</button>
          {menuOpen && (
            <div style={styles.menu}>
              <button
                type="button"
                style={{ ...styles.menuItem, ...(account.active || busy ? styles.menuItemDisabled : null) }}
                disabled={account.active || busy}
                onClick={onActivate}
              >
                {t("setDefault")}
              </button>
              <button
                type="button"
                style={{ ...styles.menuItem, ...(busy ? styles.menuItemDisabled : null) }}
                disabled={busy}
                onClick={onUpdateAuth}
              >
                {t("updateAuth")}
              </button>
              <button
                type="button"
                style={{ ...styles.menuItem, ...(busy ? styles.menuItemDisabled : null) }}
                disabled={busy}
                onClick={onRefreshModels}
              >
                {t("refreshModels")}
              </button>
              <button
                type="button"
                style={{ ...styles.menuItem, ...(busy ? styles.menuItemDisabled : null) }}
                disabled={busy}
                onClick={onManagePlan}
              >
                {t("managePlan")}
              </button>
              <button
                type="button"
                style={{ ...styles.menuItem, ...styles.menuItemDanger, ...(busy ? styles.menuItemDisabled : null) }}
                disabled={busy}
                onClick={onLogout}
              >
                {t("signOut")}
              </button>
            </div>
          )}
        </div>
      </div>
      <UsageBlock t={t} now={now} plan={account.plan} usage={account.usage} usageError={account.usageError} />
    </div>
  );
}

function CopilotSection({ t = (key) => DICTS.en[key] ?? key }) {
  const now = useUsageClock();
  const [accounts, setAccounts] = useState(null); // null = 加载中
  const [signing, setSigning] = useState(null); // 进行中的 attempt（/state 快照）
  const [error, setError] = useState(undefined);
  const [syncError, setSyncError] = useState(undefined);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkOpened, setLinkOpened] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [enterpriseStep, setEnterpriseStep] = useState(false);
  const [domain, setDomain] = useState("");
  const [menuFor, setMenuFor] = useState(null); // 打开了 … 菜单的账号 id（不透明槽位标识）
  const [busy, setBusy] = useState(false);
  const [lastStart, setLastStart] = useState(null); // {kind, domain} 最近一次失败的登录参数
  const [countdown, setCountdown] = useState(0); // 登录剩余秒数（到 0 自动取消）
  const timer = useRef(null);
  const timeoutTimer = useRef(null);

  // 停止轮询和超时计时器
  const stopTimers = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (timeoutTimer.current) { clearInterval(timeoutTimer.current); timeoutTimer.current = null; }
  };

  // 启动 5 分钟无操作超时：每秒倒计时，到 0 自动取消登录
  const startTimeout = () => {
    if (timeoutTimer.current) clearInterval(timeoutTimer.current);
    setCountdown(300);
    timeoutTimer.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          // 超时：停止计时，通知 host 重置，置失败
          if (timeoutTimer.current) { clearInterval(timeoutTimer.current); timeoutTimer.current = null; }
          if (timer.current) { clearInterval(timer.current); timer.current = null; }
          fetch("/copilot-auth/cancel", { method: "POST" }).catch(() => {});
          setSigning(null);
          setError(t("signInTimeout"));
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  // 取消登录：通知 host 重置 attempt，停止计时，清状态。
  // host 侧 background begin() 无法 abort，但 attempt 被替换为 idle 后，
  // 下次 /start 不再返回 409 already running。
  const cancelSignIn = () => {
    stopTimers();
    fetch("/copilot-auth/cancel", { method: "POST" }).catch(() => {});
    setSigning(null);
    setLastStart(null);
    setCountdown(0);
    setError(undefined);
  };

  const refreshAccounts = async () => {
    try {
      const d = await fetch("/copilot-auth/accounts").then((r) => r.json());
      setAccounts(Array.isArray(d.accounts) ? d.accounts : []);
      setSyncError(d.syncError);
    } catch {
      if (accounts === null) setAccounts([]);
    }
  };

  useEffect(() => {
    let alive = true;
    // 未结束的登录 attempt 要恢复轮询（设置面板往返导致的重挂载不丢进度）。
    fetch("/copilot-auth/state")
      .then((r) => r.json())
      .then((s) => {
        if (!alive) return;
        if (s.status === "running") {
          setSigning(s);
          poll();
        } else if (s.status === "failed") {
          setError(s.error ?? t("unknown"));
        }
      })
      .catch(() => { /* 列表以下一步查询为准 */ });
    refreshAccounts();
    return () => {
      alive = false;
      stopTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = () => {
    if (timer.current) clearInterval(timer.current);
    startTimeout();
    // 立即首次轮询，不等 1 秒——begin() 快速失败时立刻显示错误
    const tick = () => {
      fetch("/copilot-auth/state")
        .then((r) => r.json())
        .then((s) => {
          if (s.status === "running") {
            setSigning(s);
            return;
          }
          stopTimers();
          setSigning(null);
          if (s.status === "authorized") {
            setCopied(false);
            setLastStart(null);
            setError(void 0);
            setCountdown(0);
            refreshAccounts();
          } else {
            setError(s.error ?? t("unknown"));
          }
        })
        .catch(() => { /* 网络抖动时继续下一轮轮询 */ });
    };
    tick();
    timer.current = setInterval(tick, 1000);
  };

  const start = async (kind, domainValue) => {
    setAddOpen(false);
    setEnterpriseStep(false);
    setError(undefined);
    setCopied(false);
    setLinkCopied(false);
    setLinkOpened(false);
    setLastStart({ kind, domain: domainValue });
    try {
      const res = await fetch("/copilot-auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, domain: domainValue }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSigning({ status: "running", notices: [], kind, domain: domainValue });
      poll();
    } catch (err) {
      setError(String(err?.message ?? err));
    }
  };

  // 重试上次失败的登录
  const retry = () => {
    if (lastStart === null) return;
    start(lastStart.kind, lastStart.domain);
  };

  // 取消错误状态
  const cancelError = () => {
    setError(undefined);
    setLastStart(null);
  };

  const activate = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null);
    setBusy(true);
    try {
      const res = await fetch("/copilot-auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    }
    await refreshAccounts();
    setBusy(false);
  };

  const logout = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null);
    setBusy(true);
    try {
      const res = await fetch("/copilot-auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    }
    await refreshAccounts();
    setBusy(false);
  };

  // 更新授权：保留槽位并触发同域名登录；后端按域名 + login 复用原 id。
  // 不预先注销，避免登录取消/失败时丢失仍可用的授权。
  const updateAuth = async (account) => {
    setMenuFor(null);
    const kind = account.domain === "github.com" ? "github.com" : "ghe.com";
    const domainValue = account.domain === "github.com" ? undefined : account.domain;
    await start(kind, domainValue);
  };

  const refreshModels = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null); setBusy(true);
    try {
      const res = await fetch("/copilot-auth/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) setError(t("refreshModelsFailed"));
    } catch { setError(t("refreshModelsFailed")); }
    await refreshAccounts(); setBusy(false);
  };

  // 管理套餐：打开 GitHub 设置页。
  const managePlan = (account) => {
    setMenuFor(null);
    const base = account.domain === "github.com" ? "https://github.com" : `https://${account.domain}`;
    window.open(`${base}/settings/copilot`, "_blank", "noopener");
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  // 打开授权链接：调 host 端 /open 路由，用 OS 默认浏览器打开。
  // Electron 中 window.open 和 <a target="_blank"> 不可靠——主进程可能拦截。
  const openSite = async (url) => {
    if (!url) return;
    try {
      const r = await fetch("/copilot-auth/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (r.ok) setLinkOpened(true);
    } catch { /* 网络错误时静默 */ }
  };

  // 复制授权链接（参考截图：次按钮 Copy link，点击后短暂变 ✓ 已复制）
  const copyLinkUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const closeMenus = () => {
    setAddOpen(false);
    setMenuFor(null);
  };
  // dsh-llm-pi-ai 的 relay() 把 pi-ai device_code 事件映射为
  // { message, url, code } 格式（login.ts L60-66）
  const codeNotice = signing ? [...(signing.notices ?? [])].reverse()
    .find((n) => n && typeof n.code === "string" && n.code !== "") : undefined;
  const codeUrl = codeNotice?.url;

  // 参考GitHub Copilot desktop：设备码一出现就自动用系统浏览器打开授权页，
  // 无需手动点击。以设备码字符串为键，每条新码只自动开一次（重试生成新码会再开）；
  // 自动打开失败（如被拦截）时仍保留手动 Open 按钮兜底。
  const autoOpenedRef = useRef(null);
  useEffect(() => {
    if (!codeUrl || !codeNotice?.code || autoOpenedRef.current === codeNotice.code) return;
    autoOpenedRef.current = codeNotice.code;
    setLinkOpened(false);
    void openSite(codeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeUrl, codeNotice?.code]);
  const signInTarget = signing?.kind === "ghe.com" && signing?.domain
    ? `${t("optGhe")}（${signing.domain}）`
    : t("optGithub");

  return (
    <div style={styles.section}>
      {(addOpen || menuFor !== null) && <div style={styles.backdrop} onClick={closeMenus} />}
      <div style={styles.headerRow}>
        <h3 style={styles.title}>{t("title")}</h3>
        <div style={{ position: "relative", flex: "none" }}>
          <button type="button" style={styles.addButton} onClick={() => { setMenuFor(null); setAddOpen((v) => !v); }}>
            <span dangerouslySetInnerHTML={{ __html: PLUS_SVG }} />
            {t("addAccount")}
            <span dangerouslySetInnerHTML={{ __html: CHEVRON_DOWN_SVG }} />
          </button>
          {addOpen && (
            <div style={styles.menu}>
              <button type="button" style={styles.menuItem} onClick={() => start("github.com")}>
                {t("optGithub")}
                <div style={styles.menuDesc}>{t("optGithubDesc")}</div>
              </button>
              <button
                type="button"
                style={styles.menuItem}
                onClick={() => { setAddOpen(false); setEnterpriseStep(true); }}
              >
                {t("optGhe")}
                <div style={styles.menuDesc}>{t("optGheDesc")}</div>
              </button>
            </div>
          )}
        </div>
      </div>
      <p style={styles.intro}>{t("intro")}</p>

      {enterpriseStep && (
        <div style={styles.card}>
          <label style={styles.sub} htmlFor="ghc-domain">{t("domainLabel")}</label>
          <div style={styles.codeRow}>
            <input
              id="ghc-domain"
              style={styles.input}
              placeholder={t("domainPlaceholder")}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <button
              type="button"
              style={{ ...styles.button, ...styles.primary }}
              disabled={domain.trim() === ""}
              onClick={() => start("ghe.com", domain.trim())}
            >
              {t("continue")}
            </button>
            <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => setEnterpriseStep(false)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {signing?.status === "running" && (
        <div style={styles.card}>
          <span dangerouslySetInnerHTML={{ __html: SPINNER_STYLE }} />
          <div>
            <h4 style={{ ...styles.title, fontSize: 16 }}>{t("addGithubTitle")}</h4>
            <p style={{ ...styles.intro, marginTop: 4 }}>
              {(signing.domain && signing.domain !== "github.com"
                ? t("addGheDesc") : t("addGithubDesc")).replace("{domain}", signing.domain).replace("{target}", signing.domain ?? t("optGithub"))}
            </p>
          </div>
          {codeNotice && (
            <div style={{ ...styles.codeRow, cursor: "pointer" }} onClick={() => copyCode(codeNotice.code)} role="button" tabIndex={0}>
              <span style={styles.code}>{codeNotice.code}</span>
              <span dangerouslySetInnerHTML={{ __html: copied ? CHECK_SVG : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex:none;opacity:0.5"><rect x="5" y="5" width="9" height="9" rx="2"/><rect x="2" y="2" width="9" height="9" rx="2"/></svg>' }} />
            </div>
          )}
          {/* 三步状态指示器 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px", opacity: copied ? 1 : 0.5 }}>
              <span dangerouslySetInnerHTML={{ __html: copied ? CHECK_SVG : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;opacity:0.4"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>' }} />
              <span>{t("stepCopied")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px", opacity: linkOpened ? 1 : 0.5 }}>
              <span dangerouslySetInnerHTML={{ __html: linkOpened ? CHECK_SVG : GLOBE_SVG }} />
              <span>{t("stepOpened").replace("{target}", signing.domain ?? t("optGithub"))}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px" }}>
              <span dangerouslySetInnerHTML={{ __html: SPINNER_SVG }} />
              <span>{t("stepWaiting")}</span>
              {countdown > 0 && <span style={{ opacity: 0.4, fontSize: 12 }}>({Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")})</span>}
            </div>
          </div>
          {/* 按钮组：Open 调 host 端 /open 路由→系统默认浏览器。
              Electron 中 <a target="_blank"> 和 window.open 不可靠。 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {codeUrl && (
              <button type="button"
                style={{ ...styles.button, background: "#2ea44f", color: "#fff", border: "none" }}
                onClick={() => openSite(codeUrl)}>
                {t("openSite").replace("{target}", signing.domain ?? t("optGithub"))}
              </button>
            )}
            {codeUrl && (
              <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => copyLinkUrl(codeUrl)}>
                {linkCopied ? t("copied") : t("copyLink")}
              </button>
            )}
          </div>
          <div>
            <button type="button" style={{ ...styles.button, ...styles.secondary, opacity: 0.7 }} onClick={cancelSignIn}>
              {t("cancelSignIn")}
            </button>
          </div>
        </div>
      )}

      {error && lastStart !== null && (
        <div style={styles.errorCard}>
          <h4 style={styles.errorCardTitle}>{t("authFailed")}</h4>
          <p style={styles.errorCardDesc}>
            {t("authFailedDesc").replace("{target}",
              lastStart.kind === "ghe.com" && lastStart.domain ? lastStart.domain : t("optGithub"))}
          </p>
          <div style={styles.alertBox}>
            <span style={styles.alertIcon}>!</span>
            <span>{friendlyError(error, t)}</span>
          </div>
          <div style={styles.errorActions}>
            <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={cancelError}>
              {t("cancel")}
            </button>
            <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={retry}>
              {t("tryAgain")}
            </button>
          </div>
        </div>
      )}
      {error && lastStart === null && (
        <p style={styles.error}>{error}</p>
      )}

      <CombinedUsage accounts={accounts} t={t} />
      <UsageMonthSummary now={now} t={t} />
      {accounts === null ? (
        <p style={styles.sub}>{t("loading")}</p>
      ) : accounts.length === 0 && signing === null ? (
        <p style={styles.sub}>{t("noAccounts")}</p>
      ) : (
        accounts.map((account) => (
          <AccountCard
            key={account.id}
            t={t}
            account={account}
            now={now}
            busy={busy}
            menuOpen={menuFor !== null && menuFor === account.id}
            onToggleMenu={() => setMenuFor((v) => (v === account.id ? null : account.id))}
            onActivate={() => activate(account.id)}
            onLogout={() => logout(account.id)}
            onUpdateAuth={() => updateAuth(account)}
            onRefreshModels={() => refreshModels(account.id)}
            onManagePlan={() => managePlan(account)}
            onAvatarRecovered={refreshAccounts}
          />
        ))
      )}

      {accounts?.length > 0 && <p style={{ ...styles.muted, marginTop: 4 }}>{t("creditsNote")}</p>}
      {syncError && <p style={styles.muted}>sync: {syncError}</p>}
    </div>
  );
}

// 简化版 Copilot 图标（16x16，currentColor）
const BADGE_COPILOT_SVG =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none">' +
  '<path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.358.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/>' +
  '<path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>';

// 账号头像：风格对齐 DSH AccountAvatar（圆形成片、object-fit:cover、
// referrerPolicy=no-referrer、加载失败兜底）。弹窗身份行与账号切换列表共用，
// 保证两处头像尺寸/兜底完全一致。
const EMPTY_AVATAR_IMAGE = Object.freeze({ status: "invalid", hasImage: false, failureRevision: 0 });
function AccountAvatar({ id, issuer, slot = "row", url, login, size = 18, onRecovered, requestProfile, scopeKey, isCurrent }) {
  const containerRef = useRef(null), leaseRef = useRef(null), ownerRef = useRef(null), guardRef = useRef(isCurrent), errorRef = useRef(null);
  guardRef.current = isCurrent;
  if (ownerRef.current === null || ownerRef.current.scopeKey !== scopeKey || ownerRef.current.id !== id || ownerRef.current.issuer !== issuer || ownerRef.current.slot !== slot) {
    const owner = { scopeKey, id, issuer, slot, recoveryScope: {} };
    owner.current = () => { try { return ownerRef.current === owner && typeof guardRef.current === "function" && guardRef.current() === true; } catch { return false; } };
    ownerRef.current = owner;
  }
  const owner = ownerRef.current;
  const image = useAvatarRecovery(id, url, (nextSource) => {
    const held = leaseRef.current;
    if (!owner.current() || held?.owner !== owner) return;
    if (typeof nextSource === "string" && nextSource !== "") void held.lease.refresh(nextSource).catch(() => {});
    return onRecovered?.(nextSource);
  }, requestProfile, owner.recoveryScope, owner.current);
  errorRef.current = image.onError;
  const [cached, setCached] = useState({ owner: null, value: EMPTY_AVATAR_IMAGE });
  const enabled = scopeKey !== null && typeof scopeKey === "object" && typeof issuer === "string" && issuer !== "" && typeof id === "string" && id !== "" && typeof image.source === "string" && image.source !== "";
  useLayoutEffect(() => {
    if (!enabled || !owner.current()) return;
    let lease;
    try { lease = avatarImageCache.acquire({ scope: scopeKey, issuer, accountId: id, slot, source: image.source, isCurrent: owner.current }); }
    catch { setCached({ owner, value: EMPTY_AVATAR_IMAGE }); return; }
    const held = { owner, lease }; leaseRef.current = held;
    let live = true, seenFailure = lease.snapshot().failureRevision ?? 0;
    const sync = () => {
      if (!live || !owner.current()) return;
      const value = lease.snapshot(); setCached({ owner, value });
      if (value.reason === "load-failed" && value.failureRevision > seenFailure) {
        seenFailure = value.failureRevision;
        queueMicrotask(() => { if (live && owner.current()) errorRef.current?.(); });
      }
    };
    const unsubscribe = lease.subscribe(sync), detach = lease.attach(containerRef.current);
    sync();
    return () => { live = false; unsubscribe(); detach(); lease.release(); if (leaseRef.current === held) leaseRef.current = null; };
  }, [owner, enabled]);
  // Ordinary signed-URL rotation does not force a new load inside the soft TTL.
  useLayoutEffect(() => { const held = leaseRef.current; if (held?.owner === owner && owner.current() && image.source) held.lease.updateSource(image.source); }, [owner, image.source]);
  const state = enabled && cached.owner === owner ? cached.value : EMPTY_AVATAR_IMAGE;
  const direct = state.status === "fallback" && ["capacity", "slot-in-use", "oversized"].includes(state.reason) && image.source && !image.failed;
  const box = { width: size, height: size, borderRadius: "50%", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#adb5bd" };
  return <span style={box}>
    <span ref={containerRef} style={{ width: "100%", height: "100%", display: state.hasImage ? "block" : "none" }} />
    {direct ? <img key={image.revision} src={image.source} alt="" referrerPolicy="no-referrer" onError={image.onError}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }} />
      : !state.hasImage && <span style={{ fontSize: Math.round(size * 0.55), color: "#fff", fontWeight: 600 }}>{(login ?? "?")[0]?.toUpperCase() ?? "?"}</span>}
  </span>;
}

const EMPTY_SESSION_BADGE = { status: "loading", catalog: null, errorCode: null, busy: false, running: false, scopeKey: {}, requestProfile: undefined };
function useSessionBadge(sessionId, sessions) {
  const [state, setState] = useState(EMPTY_SESSION_BADGE);
  useEffect(() => {
    let live = true, controller;
    try { controller = createSessionBadgeController({ sessionId, sessions }); }
    catch {
      setState({ ...EMPTY_SESSION_BADGE, status: "unavailable", errorCode: "SESSION_UNAVAILABLE", sessionId, sessions });
      return;
    }
    const publish = () => { if (live) setState({ ...controller.getSnapshot(), controller, sessionId, sessions }); };
    const unsubscribe = controller.subscribe(publish);
    publish();
    void controller.refresh();
    const timer = setInterval(() => { void controller.refresh(); }, 30000);
    return () => { live = false; clearInterval(timer); unsubscribe(); controller.dispose(); };
  }, [sessionId, sessions]);
  // New props must not display the previous Session before effect cleanup runs.
  return state.sessionId === sessionId && state.sessions === sessions ? state : EMPTY_SESSION_BADGE;
}

function CopilotBadge({ sessionId, sessions, t = (k) => DICTS.en[k] ?? k }) {
  const now = useUsageClock();
  const runtime = useSessionBadge(sessionId, sessions);
  const [open, setOpen] = useState(false);
  const badgeRef = useRef(null);
  const ready = runtime.status === "ready";
  const view = deriveSessionBadgeState(runtime.catalog, { busy: runtime.busy || !ready, running: runtime.running });
  useEffect(() => { setOpen(false); }, [sessionId, runtime.scopeKey]);
  useEffect(() => { if (runtime.failureNotice != null) setOpen(false); }, [runtime.failureNotice?.id]);
  const refresh = () => runtime.controller?.refresh(true);
  const mutate = async (method, accountId) => {
    const accepted = await runtime.controller?.[method](accountId);
    if (accepted && method === "bind") setOpen(false);
  };
  const selectedLabel = view.account ? accountLabel(view.account, t("legacyAccount")) : undefined;
  const selectedBound = view.mode === "bound" ? view.accounts.find((account) => account.id === view.selectedAccountId) : undefined;
  const canOfferGlobal = selectedBound !== undefined && selectedBound.available !== false && selectedBound.id !== view.globalAccountId;
  const statusLabel = !ready ? runtime.status === "loading" ? t("loading") : t("badgeUnavailable")
    : view.mode === "inactive" ? t("badgeNotInUse") : view.unavailable ? t(view.mode === "bound" ? "badgeBoundUnavailable" : "badgeUnavailable")
      : view.unmanaged ? "—" : !view.account ? t("badgeNoDefault") : view.remaining !== null ? `${t("badgeQuotaPrefix")} ${view.remaining}%`
        : view.unlimited ? "∞" : t("badgeUnknownQuota");
  const title = [selectedLabel, view.unmanaged ? t("badgeUnmanaged") : view.mode === "bound" ? t("badgeSessionBound") : view.mode === "global" ? t("badgeFollowingGlobal") : undefined,
    view.remaining !== null ? `${t("badgeQuotaRemaining")} ${view.remaining}%` : statusLabel,
    view.running ? t("badgeRunningHint") : undefined, t("badgeHistoryHint"),
  ].filter(Boolean).join(" · ");
  const rect = badgeRef.current?.getBoundingClientRect();
  const popupStyle = rect ? {
    position: "fixed", left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
    bottom: window.innerHeight - rect.top + 4, minWidth: Math.min(320, window.innerWidth - 16),
    maxWidth: "calc(100vw - 16px)", maxHeight: "70vh", overflowY: "auto",
    background: "var(--dsh-bg, #fff)", color: "var(--dsh-fg, inherit)",
    border: "1px solid rgba(128,128,128,0.3)", borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 100001,
  } : null;
  const actionStyle = { border: "none", borderRadius: 4, background: "transparent", color: "inherit", fontFamily: "inherit", cursor: "pointer" };
  const avatarProps = { requestProfile: runtime.requestProfile, scopeKey: runtime.scopeKey, isCurrent: runtime.isCurrent, onRecovered: refresh };
  return (
    <div style={{ position: "relative", flex: "none" }} ref={badgeRef}>
      <button type="button" className="copilot-badge" title={title} aria-description={t("badgeHistoryHint")} aria-expanded={open}
        style={{ opacity: view.account ? 1 : 0.55 }}
        onClick={() => { setOpen((value) => !value); if (!open) void refresh(); }}>
        <span dangerouslySetInnerHTML={{ __html: BADGE_COPILOT_SVG }} />
        <span className="copilot-badge-label" style={view.remaining !== null && view.remaining < 20 ? { color: "#e03131" } : undefined}>{statusLabel}</span>
      </button>
      {open && runtime.failureNotice == null && popupStyle && createPortal(<>
        <div style={{ position: "fixed", inset: 0, zIndex: 100000 }} onClick={() => setOpen(false)} />
        <div role="dialog" aria-label={t("badgeSessionAccounts")} aria-description={t("badgeHistoryHint")} aria-busy={runtime.busy} style={popupStyle}>
          <CombinedUsage accounts={view.accounts} t={t} menu />
          <UsageMonthSummary now={now} t={t} menu />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
            {view.account && <AccountAvatar id={view.account.id} issuer={view.account.domain} slot="header" url={view.account.avatarUrl} login={view.account.login} {...avatarProps} />}
            <span title={selectedLabel} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }}>{selectedLabel ?? "GitHub Copilot"}</span>
            <button type="button" style={{ ...actionStyle, padding: "2px 6px" }} aria-label={t("cancel")} onClick={() => setOpen(false)}>×</button>
          </div>
          {view.used !== null && <div style={{ padding: "8px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 6 }}>
              <span>{Math.round(view.used)}% {t("badgeUsed")}</span>
              {view.resets && <span style={{ opacity: 0.6 }}>{t("badgeResets")} {view.resets}</span>}
            </div>
            <UsageProgress percent={view.used} now={now} t={t} />
          </div>}
          {runtime.errorCode && <div role="alert" style={{ padding: "4px 12px 8px", fontSize: 12, color: "#e03131" }}>{t(sessionBadgeErrorKey(runtime.errorCode))}</div>}
          <button type="button" title={view.running ? t("badgeRunningHint") : t("badgeFollowGlobal")}
            disabled={!view.canBind || view.followsGlobal} onClick={() => { void mutate("bind", null); }}
            style={{ ...actionStyle, display: "flex", gap: 8, alignItems: "center", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 13, opacity: view.canBind ? 1 : 0.5 }}>
            <span style={{ flex: 1 }}>{t("badgeFollowGlobal")}</span>{view.followsGlobal && <span>✓</span>}
          </button>
          <div style={{ borderTop: "1px solid rgba(128,128,128,0.15)", padding: "4px 0" }}>
            {view.accounts.map((account) => {
              const selected = view.mode === "bound" && view.selectedAccountId === account.id;
              const accountUnavailable = account.available === false;
              const rowUnavailable = accountUnavailable || account.routeAvailable === false;
              const label = accountLabel(account, t("legacyAccount"));
              const quota = accountQuotaRemaining(account);
              const quotaTitle = quota.kind === "unknown" ? t("badgeUnknownQuota") : quota.kind === "unlimited" ? t("unlimited") : `${t("badgeQuotaRemaining")} ${quota.text}`;
              const hint = view.running ? t("badgeRunningHint") : rowUnavailable ? t(accountUnavailable ? "badgeRowUnavailable" : "badgeRouteUnavailable") : t("badgeHistoryHint");
              return <button key={account.id} type="button" title={`${label} · ${hint}`} aria-label={`${t("badgeUseSession")}: ${label}`} aria-description={quotaTitle}
                disabled={!view.canBind || selected || rowUnavailable} onClick={() => { void mutate("bind", account.id); }}
                style={{ ...actionStyle, display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", textAlign: "left", fontSize: 13,
                  background: selected ? "rgba(76,109,245,0.08)" : "transparent", opacity: !view.canBind || rowUnavailable ? 0.5 : 1 }}>
                <AccountAvatar id={account.id} issuer={account.domain} slot="row" url={account.avatarUrl} login={account.login} {...avatarProps} />
                <span title={label} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                <span data-account-quota={account.id} title={quotaTitle} aria-label={quotaTitle}
                  style={{ flex: "none", minWidth: "3ch", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                    color: quota.kind === "percent" && quota.remaining < 20 ? "#e03131" : "inherit", opacity: quota.kind === "unknown" ? 0.55 : 0.8 }}>{quota.text}</span>
                <span aria-hidden="true" style={{ flex: "none", width: "1em", textAlign: "center" }}>{selected ? "✓" : ""}</span>
              </button>;
            })}
          </div>
          <div style={{ borderTop: "1px solid rgba(128,128,128,0.15)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 12 }}>
            {canOfferGlobal && <button type="button" style={{ ...actionStyle, padding: "3px 0", fontSize: 12 }} title={t("badgeGlobalHint")}
              disabled={!view.canSetDefault} onClick={() => { void mutate("setDefault", selectedBound.id); }}>{t("badgeSetGlobalDefault")}</button>}
            <button type="button" style={{ ...actionStyle, marginLeft: "auto", padding: "3px 4px", fontSize: 14 }} title={t("badgeRefresh")} aria-label={t("badgeRefresh")} onClick={() => { void refresh(); }}>↻</button>
          </div>
        </div>
      </>, document.body)}
      <Modal open={runtime.failureNotice != null} onClose={() => runtime.controller?.dismissFailure()}
        title={t("badgeFailureTitle")} closeLabel={t("badgeClose")} description={t("badgeFailureBody")} />
    </div>
  );
}

function SettingsCopilotIcon({ size = 20, active = false }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="currentColor"
    style={{ display: "block", color: active ? "var(--dsh-accent, #4c6ef5)" : "currentColor" }}>
    <path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.358.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z" />
    <path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z" />
  </svg>;
}

export function apply(ctx) {
  ctx.locale.register("copilot-auth", DICTS);
  const t = ctx.locale.bind("copilot-auth");
  // 注入徽标全局样式：跟 ui-chat 的 StatsPills pill 同款
  // （conversation.composer.dock slot 同源），字体/颜色/图标尺寸/hover 阴影
  // 完全对齐，避免视觉违和。inline style 不支持 :hover，故走 CSS class。
  if (typeof document !== "undefined" && !document.getElementById("copilot-badge-style")) {
    const style = document.createElement("style");
    style.id = "copilot-badge-style";
    style.textContent = `
.copilot-badge{
  display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;
  max-width:240px;padding:1px 8px;border:none;border-radius:24px;
  background:transparent;color:var(--dsw-alias-label-tertiary);
  font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;
  cursor:pointer;font-family:inherit;flex:0 1 auto;position:relative;user-select:none;
  /* 与 ui-chat StatsPills .root 同款字号（secondary - 1px），保证跟旁边
     轮次/用量/命中率三个 pill 视觉一致 */
  font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);
  line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
}
.copilot-badge:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-secondary);
}
.copilot-badge svg{
  width:14px;height:14px;flex:none;
  /* octicons copilot-16 path 视觉重心偏上（DSH 标准图标在 path 层面
     做了光学偏移，参考 IconGaugeOutline16 注释「0.75 drop optically
     centers the drawn extent in the 16 box」），用 transform 补偿
     让 logo 跟其他 pill svg 视觉对齐，不破坏 path 数据 */
  transform:translateY(1px);
}
/* 响应式收缩：跟 StatsPills .label 一致（min-width:0; overflow:hidden;
   text-overflow:ellipsis），当窗口小 flex 容器收缩时文字被裁掉只留
   logo，跟旁边 StatsPills pill 行为一致。flex:0 1 auto 让 label 可收缩
   而 svg（flex:none）保持原尺寸。 */
.copilot-badge-label{
  min-width:0;overflow:hidden;text-overflow:ellipsis;
  flex:0 1 auto;white-space:nowrap;
}
`;
    document.head.appendChild(style);
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    { name: "settings.section", id: "copilot", order: 11, label: () => t("nav"), inject: () => ({ t }) },
    CopilotSection,
  ));
  ctx.slots.inject("settings.section.icon", () => ctx.slots.register(
    { name: "settings.section.icon", id: "copilot", order: 11, label: () => t("nav") },
    SettingsCopilotIcon,
  ));
  // 工作区输入栏下方 Copilot 徽标（VSCode 风格）：显示 Copilot logo，
  // 点击弹出账号信息面板（用户名/plan/用量/切换账号）。
  ctx.inject(["sessions"], (scope) => {
    const sessions = scope.sessions;
    scope.slots.inject("conversation.composer.dock", () => scope.slots.register(
      { name: "conversation.composer.dock", id: "copilot-badge", order: 50, inject: (sessionId) => ({ t, sessionId, sessions }) },
      CopilotBadge,
    ));
  });
}
