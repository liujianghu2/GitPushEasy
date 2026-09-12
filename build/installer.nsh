; ============================================================================
; installer.nsh —— NSIS 安装包定制
;
; electron-builder 会在它生成的安装脚本里插入这两个宏。
; 这里只做两件确定有意义、且不会和 electron-builder 自己写的注册表项打架的事:
;   1. 注册 gitpusheasy:// 协议(以后可以从网页唤起本程序)
;   2. 卸载时清掉我们自己写的东西 + 兜底删除可能残留的快捷方式
;
; 【刻意不做】的事:
;   · 不动 Uninstall\${UNINSTALL_APP_KEY} 下的 DisplayName / Version ——
;     electron-builder 已经写好了(用的是 productName 和版本号),
;     重复写入反而可能把它写的覆盖掉,导致"应用和功能"里显示异常。
;   · 不删 %APPDATA%\GitPushEasy —— 那里存着用户的登录信息和设置,
;     重装后应该还能继续用。程序内设置页提供了"退出并删除本机登录信息"。
; ============================================================================

!macro customInstall
  ; ---- 注册自定义协议 gitpusheasy:// ----
  WriteRegStr SHCTX "Software\Classes\gitpusheasy" "" "URL:GitPushEasy Protocol"
  WriteRegStr SHCTX "Software\Classes\gitpusheasy" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\gitpusheasy\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\gitpusheasy\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; ---- 记录安装路径与版本,方便以后排查 ----
  WriteRegStr SHCTX "Software\GitPushEasy" "InstallDir" "$INSTDIR"
  WriteRegStr SHCTX "Software\GitPushEasy" "Version" "${VERSION}"
!macroend

!macro customUnInstall
  ; ---- 清理协议注册与自查信息 ----
  DeleteRegKey SHCTX "Software\Classes\gitpusheasy"
  DeleteRegKey SHCTX "Software\GitPushEasy"

  ; ---- 兜底删除快捷方式(防止用户改动过安装目录后残留) ----
  Delete "$DESKTOP\小白推送.lnk"
  Delete "$DESKTOP\GitPushEasy.lnk"
  Delete "$SMPROGRAMS\小白推送.lnk"
  Delete "$SMPROGRAMS\GitPushEasy.lnk"
!macroend
