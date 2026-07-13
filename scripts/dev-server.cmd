@echo off
set Path=
set PATH=C:\Windows\system32;C:\Windows;C:\Program Files\nodejs
cd /d D:\MTG-AI
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next dev > next-dev.out.log 2> next-dev.err.log
