  function getReviewerSelectedClientId() {
    const filter = $('#reviewerClientFilter');
    if (!filter || filter.value === 'all' || filter.value === '') return null;
    const parsed = Number(filter.value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_ACCOUNT_ID ? parsed : null;
  }

  function enterReviewerLogin() {
    if (treasuryView) treasuryView.hidden = true;
    if (treasuryLoginView) treasuryLoginView.hidden = true;
    loginView.hidden = true;
    reviewerLoginView.hidden = false;
    reviewerView.hidden = true;
    reviewerLoginError.hidden = true;
    reviewerPinInput.value = '';
    reviewerPinInput.focus();
  }

  function returnToClientLogin() {
    reviewerSession = false;
    reviewerView.hidden = true;
    reviewerLoginView.hidden = true;
    if (treasuryLoginView) treasuryLoginView.hidden = true;
    if (treasuryView) treasuryView.hidden = true;
    loginView.hidden = false;
    reviewerPinInput.value = '';
    reviewerLoginError.hidden = true;
    accountSelect.focus();
  }

  function loginReviewer(event) {
    event.preventDefault();
    const suppliedPin = reviewerPinInput.value.trim();
    if (!/^\d{6}$/.test(suppliedPin) || suppliedPin !== REVIEWER_PIN) {
      reviewerLoginError.textContent = 'Clave incorrecta. Verifica los seis dígitos e inténtalo de nuevo.';
      reviewerLoginError.hidden = false;
      reviewerPinInput.setAttribute('aria-invalid', 'true');
      reviewerPinInput.focus();
      return;
    }
    treasurySession = false;
    reviewerSession = true;
    persistTabSession('analyst', null);
    reviewerLoginView.hidden = true;
    loginView.hidden = true;
    appView.hidden = true;
    reviewerView.hidden = false;
    reviewerPinInput.value = '';
    reviewerLoginError.hidden = true;
    $('#reviewerFooterYear').textContent = String(new Date().getFullYear());
    if (typeof setReviewerActivePage === 'function') setReviewerActivePage('overview');
    renderReviewerDashboard();
  }

  function logoutReviewer() {
    clearTabSession();
    reviewerSession = false;
    reviewerView.hidden = true;
    reviewerLoginView.hidden = true;
    if (treasuryLoginView) treasuryLoginView.hidden = true;
    if (treasuryView) treasuryView.hidden = true;
    loginView.hidden = false;
    reviewerPinInput.value = '';
    reviewerLoginError.hidden = true;
    accountSelect.focus();
  }

  function renderReviewerDashboard() {
    if (!reviewerSession) return;
    if (typeof populateReviewerClientFilter === 'function') populateReviewerClientFilter();
    const allApplications = Array.isArray(db.creditApplications)
      ? db.creditApplications.filter((item) => item.origin !== 'Aumento de cupo')
      : [];
    const selectedClientId = getReviewerSelectedClientId();
    const applications = allApplications.filter((item) => selectedClientId === null || Number(item.accountId) === selectedClientId);
    const pending = applications.filter((item) => (item.status || 'En revisión') === 'En revisión').length;
    const approved = applications.filter((item) => ['Aprobado', 'Desembolsado', 'Pagado'].includes(item.status)).length;
    const rejected = applications.filter((item) => item.status === 'Rechazado').length;
    $('#reviewerCountAll').textContent = String(applications.length);
    $('#reviewerCountPending').textContent = String(pending);
    $('#reviewerCountApproved').textContent = String(approved);
    $('#reviewerCountRejected').textContent = String(rejected);
    $('#reviewerFundTotal').textContent = money(totalAnalystBalance());
    $('#reviewerFundCommitted').textContent = money(analystCapitalCommitted());
    $('#reviewerFundAvailable').textContent = money(availableAnalystCapital());
    $('#reviewerFundInterest').textContent = money(totalInterestEarned());
    if (typeof renderReviewerCommissionCards === 'function') renderReviewerCommissionCards();
    if (typeof renderReviewerClientSummary === 'function') renderReviewerClientSummary();
    renderReviewerApplications();
    renderReviewerLimitIncreaseRequests();
    if (typeof renderReviewerAutomaticAdvances === 'function') renderReviewerAutomaticAdvances();
    const activePage = reviewerView?.querySelector('[data-reviewer-tab][aria-current="page"]')?.dataset.reviewerTab;
    if (activePage === 'tools') {
      if (typeof renderFinancialAuditPanel === 'function') renderFinancialAuditPanel();
      if (typeof renderMonthlyFinancialReport === 'function') renderMonthlyFinancialReport();
    }
  }
