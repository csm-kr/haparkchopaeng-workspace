; Register on installation as well as first launch, including silent installs.
!define CONNECTOR_PROTOCOL_KEY "Software\Classes\hapark-connect"

!macro customInstall
  WriteRegStr SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}" "" "URL:Hapark AI Connection"
  WriteRegStr SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}\shell\open\command" ""
  StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  ; Never remove a registration that another installation now owns.
  ${if} $0 == $1
    DeleteRegKey SHELL_CONTEXT "${CONNECTOR_PROTOCOL_KEY}"
  ${endIf}
!macroend
