@echo off
echo Adding labels to all issues...
echo.

:: WEBAPP ISSUES (Issues 510-519 based on output)
echo Adding labels to Webapp Issues...
for /L %%i in (510,1,519) do (
  gh issue edit %%i --add-label "webapp,enhancement"
)
echo Webapp Issues labeled!
echo.

:: MOBILE ISSUES (Issues 520-534)
echo Adding labels to Mobile Issues...
for /L %%i in (520,1,534) do (
  gh issue edit %%i --add-label "mobile,enhancement"
)
echo Mobile Issues labeled!
echo.

:: DATA PROCESSING ISSUES (Issues 535-549)
echo Adding labels to Data Processing Issues...
for /L %%i in (535,1,549) do (
  gh issue edit %%i --add-label "backend,data-processing"
)

:: Add specific labels to data processing issues
gh issue edit 538 --add-label "ai-ml"
gh issue edit 539 --add-label "analytics"
gh issue edit 540 --add-label "mlops"
gh issue edit 541 --add-label "mlops"
gh issue edit 542 --add-label "streaming"
gh issue edit 543 --add-label "ai-ml"
gh issue edit 544 --add-label "nlp"
gh issue edit 545 --add-label "analytics"
gh issue edit 546 --add-label "data-modeling"
gh issue edit 547 --add-label "data-quality"
gh issue edit 548 --add-label "devops"
gh issue edit 549 --add-label "ranking"
echo Data Processing Issues labeled!
echo.

:: BACKEND ISSUES (Need to check issue numbers - should be after 549)
echo Adding labels to Backend Issues...
for /L %%i in (550,1,569) do (
  gh issue edit %%i --add-label "backend"
)

:: Add specific labels to backend issues
gh issue edit 550 --add-label "auth,stellar"
gh issue edit 551 --add-label "api"
gh issue edit 552 --add-label "security"
gh issue edit 553 --add-label "api,performance"
gh issue edit 554 --add-label "devops,security"
gh issue edit 555 --add-label "caching,performance"
gh issue edit 556 --add-label "reliability,payments"
gh issue edit 557 --add-label "search,product"
gh issue edit 558 --add-label "notifications,product"
gh issue edit 559 --add-label "security,integrations"
gh issue edit 560 --add-label "portfolio,performance"
gh issue edit 561 --add-label "reliability,stellar"
gh issue edit 562 --add-label "architecture,reliability"
gh issue edit 563 --add-label "dx,release"
gh issue edit 564 --add-label "observability,devops"
gh issue edit 565 --add-label "exports,product"
gh issue edit 566 --add-label "moderation"
gh issue edit 567 --add-label "security,auth"
gh issue edit 568 --add-label "database,performance"
gh issue edit 569 --add-label "product,workflow"
echo Backend Issues labeled!
echo.

:: SMART CONTRACT ISSUES (Should be after 569)
echo Adding labels to Smart Contract Issues...
for /L %%i in (570,1,592) do (
  gh issue edit %%i --add-label "smart-contracts,soroban"
)

:: Add specific labels to contract issues
gh issue edit 571 --add-label "security"
gh issue edit 573 --add-label "defi"
gh issue edit 574 --add-label "oracle"
gh issue edit 576 --add-label "ux"
gh issue edit 578 --add-label "treasury"
gh issue edit 580 --add-label "security"
gh issue edit 582 --add-label "fees"
gh issue edit 583 --add-label "governance"
gh issue edit 585 --add-label "defi"
gh issue edit 586 --add-label "testing"
gh issue edit 588 --add-label "architecture"
gh issue edit 590 --add-label "analytics"
gh issue edit 591 --add-label "ux"
gh issue edit 592 --add-label "governance"
echo Smart Contract Issues labeled!
echo.

echo ========================================
echo All issues labeled successfully!
echo ========================================
