#!/bin/bash
LABEL="com.digitalstudio.runner"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "자동 실행을 껐어요. 다시 켜려면 '자동실행 켜기.command' 를 더블클릭하세요."
read -r -p "엔터를 누르면 닫혀요"
