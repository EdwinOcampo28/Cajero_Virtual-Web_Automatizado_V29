  async function resetDemoData() {
    const transactionRevision = captureDatabaseRevision();
    const confirmed = await showAppDialog({
      type: 'confirm',
      title: 'Borrar todos los datos del sistema',
      message: 'Esta acción eliminará los saldos y todos los registros guardados del cajero: movimientos, solicitudes, créditos, desembolsos, cuotas, abonos e intereses acumulados. Las tres cuentas de prueba y sus PIN se conservarán para poder volver a entrar, pero quedarán en $ 0 y sin historial. La Tesorería también se reiniciará a $ 0 y su cronómetro empezará de nuevo. La copia independiente de configuración se conservará y se aplicará al sistema limpio. Esta acción no se puede deshacer.',
      eyebrow: 'BORRADO TOTAL · ACCIÓN IRREVERSIBLE',
      icon: '!',
      confirmText: 'Borrar todos los datos',
      danger: true
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }

    try {
      // Remove a broken or oversized store before creating the clean demo state.
      // Keeping a snapshot here could restore damaged data when storage is full.
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      showToast('El navegador no permitió borrar los datos guardados. Revisa los permisos de almacenamiento de esta página e inténtalo de nuevo.', 'error');
      return;
    }

    lastPersistedRaw = null;
    databaseLoadIssue = false;
    dbRevision += 1;
    db = freshDatabase();
    recordAuditEvent('Reinicio total del sistema', {
      category: 'sistema', source: 'Analista',
      description: 'Se borraron los datos operativos y se reinició la demostración a solicitud explícita del usuario.'
    });
    const resetSaved = saveDatabase();

    clearTabSession();
    activeAccountId = null;
    reviewerSession = false;
    treasurySession = false;
    if (typeof stopTreasuryTimer === 'function') stopTreasuryTimer();
    closeModal();
    appView.hidden = true;
    reviewerView.hidden = true;
    reviewerLoginView.hidden = true;
    if (treasuryLoginView) treasuryLoginView.hidden = true;
    if (treasuryView) treasuryView.hidden = true;
    loginView.hidden = false;
    loginError.hidden = true;
    pinInput.value = '';
    reviewerPinInput.value = '';
    showToast(resetSaved
      ? 'Todos los datos operativos fueron borrados. Las tres cuentas y la Tesorería quedaron en $ 0 y sin historial; la configuración guardada se conservó.'
      : 'Los datos anteriores fueron borrados. El navegador no pudo guardar el estado inicial; vuelve a abrir la página para iniciar una demostración limpia.', resetSaved ? 'success' : 'warning');
    accountSelect.focus();
  }
