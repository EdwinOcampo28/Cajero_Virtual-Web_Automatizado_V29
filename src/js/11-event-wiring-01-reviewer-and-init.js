  // Inicialización tardía: todos los módulos de lógica ya están cargados.
  db = loadDatabase();
  if (databaseLoadIssue) {
    const recoveryMessage = $('#databaseRecoveryMessage');
    if (recoveryMessage) {
      recoveryMessage.textContent = 'No se pudieron validar los datos guardados. No se borraron. Si tienes una copia, entra como analista e impórtala; si no, usa “Borrar datos guardados” y confirma para reiniciar.';
      recoveryMessage.hidden = false;
    }
  }

  reviewerAccessButton.addEventListener('click', enterReviewerLogin);
  $('#backToClientLogin').addEventListener('click', returnToClientLogin);
  reviewerLoginForm.addEventListener('submit', loginReviewer);
  reviewerPinInput.addEventListener('input', () => {
    reviewerPinInput.value = reviewerPinInput.value.replace(/\D/g, '').slice(0, 6);
    reviewerLoginError.hidden = true;
    reviewerPinInput.setAttribute('aria-invalid', 'false');
  });
  $('#reviewerLogoutButton').addEventListener('click', logoutReviewer);
  reviewerFilter.addEventListener('change', renderReviewerApplications);
  reviewerApplicationsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-review-id][data-review-decision]');
    if (!button) return;
    registerCreditDecision(button.dataset.reviewId, button.dataset.reviewDecision);
  });
  reviewerLimitRequestsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-limit-request-id][data-limit-request-decision]');
    if (!button) return;
    registerLimitIncreaseDecision(button.dataset.limitRequestId, button.dataset.limitRequestDecision);
  });
