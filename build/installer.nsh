; Custom NSIS behaviour for the NextGoal installer.
; electron-builder auto-includes build/installer.nsh (buildResources = build).

; On a manual uninstall, offer to also remove the user's data — settings,
; Twitch login, and the saved OBS password (all under %APPDATA%\nextgoal).
; The /SD IDNO default means silent uninstalls (e.g. the one an app update
; runs) keep the data, so updating never wipes a user's settings.
!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Also remove your NextGoal settings, Twitch login, and saved OBS password?$\n$\nChoose No to keep them for a future reinstall." /SD IDNO IDNO ng_keep_appdata
    RMDir /r "$APPDATA\nextgoal"
  ng_keep_appdata:
!macroend
