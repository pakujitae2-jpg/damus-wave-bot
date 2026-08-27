@echo off
REM 러너와 대시보드를 정지한다. 거래소 포지션은 그대로 남는다 (청산하지 않음).
cd /d %~dp0
echo 러너 정지...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*run_live_semi.py*' -or $_.CommandLine -like '*run_paper.py*' } | ForEach-Object { Write-Host ('  종료 pid ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
echo 대시보드 정지...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*vite*' -and $_.CommandLine -like '*3100*' } | ForEach-Object { Write-Host ('  종료 pid ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
echo.
echo   정지 완료. 거래소에 열려 있는 포지션과 손절/TP 주문은 그대로 남아 있습니다.
pause
