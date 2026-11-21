; Page facultative de l'installateur : Audiveris (lecture des partitions scannées)
!define AUDIVERIS_URL "https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windows-x86_64.msi"

!macro customPageAfterChangeDir
  Var AudCheck
  Var AudWant

  Page custom AudPageCreate AudPageLeave

  Function AudPageCreate
    StrCpy $AudWant 0
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${FileExists} "$PROGRAMFILES64\Audiveris\Audiveris.exe"
    ${OrIf} ${FileExists} "$LOCALAPPDATA\Programs\Audiveris\Audiveris.exe"
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Modules complémentaires" "Facultatif"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 14u "Audiveris : lecture des partitions scannées (85 Mo)"
    Pop $AudCheck
    ${NSD_Check} $AudCheck
    ${NSD_CreateLabel} 12u 18u 95% 24u "Téléchargé et installé après Partoch. Il peut aussi être installé plus tard depuis Partoch."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function AudPageLeave
    ${NSD_GetState} $AudCheck $AudWant
  FunctionEnd
!macroend

!macro customInstall
  ${If} $AudWant == ${BST_CHECKED}
  ${AndIfNot} ${Silent}
    DetailPrint "Téléchargement d'Audiveris…"
    inetc::get /CAPTION "Audiveris" "${AUDIVERIS_URL}" "$PLUGINSDIR\Audiveris.msi" /END
    Pop $0
    ${If} $0 == "OK"
      DetailPrint "Installation d'Audiveris…"
      ExecWait '"$SYSDIR\msiexec.exe" /i "$PLUGINSDIR\Audiveris.msi" /passive' $1
      Delete "$PLUGINSDIR\Audiveris.msi"
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "Audiveris n'a pas pu être téléchargé. Partoch proposera de l'installer plus tard."
    ${EndIf}
  ${EndIf}
!macroend
