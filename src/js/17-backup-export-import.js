  // Copias de seguridad locales. Solo el analista puede exportar/importar la base completa.
  // El checksum detecta daños accidentales; no es una firma criptográfica de identidad.
  const BACKUP_FORMAT = 'cajero-virtual-backup';
  const BACKUP_SCHEMA_VERSION = 2;
  const SUPPORTED_BACKUP_SCHEMA_VERSIONS = [1, 2];
  const MAX_BACKUP_FILE_BYTES = 15 * 1024 * 1024;

  async function calculateBackupDigest(database, requestedAlgorithm = 'auto') {
    const payload = JSON.stringify(database);
    const canUseSha256 = Boolean(globalThis.crypto?.subtle && typeof TextEncoder === 'function');
    const algorithm = requestedAlgorithm === 'auto'
      ? (canUseSha256 ? 'SHA-256' : 'FNV1A-32-UTF16')
      : requestedAlgorithm;

    if (algorithm === 'SHA-256') {
      if (!canUseSha256) throw new Error('Este navegador no permite verificar SHA-256. Abre la copia en una versión actual de Edge o Chrome.');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
      return { algorithm, digest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') };
    }
    if (algorithm !== 'FNV1A-32-UTF16') throw new Error('El algoritmo de integridad de la copia no está admitido.');

    // Fallback portable para navegadores locales sin Web Crypto. Detecta corrupción accidental.
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return { algorithm, digest: hash.toString(16).padStart(8, '0') };
  }

  async function makeBackupEnvelope() {
    const database = JSON.parse(JSON.stringify(db));
    const integrity = await calculateBackupDigest(database);
    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      app: 'Cajero Virtual',
      appVersion: 'v45.0',
      exportedAt: new Date().toISOString(),
      integrity,
      database
    };
  }

  function backupMoneyIsValid(value, maximum = Number.MAX_SAFE_INTEGER) {
    return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  }

  function validateBackupDatabase(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'El archivo no contiene una base de datos válida.';
    if (!Array.isArray(data.accounts) || ![MAX_ACCOUNT_ID + 1, MAX_ACCOUNT_ID + 2].includes(data.accounts.length) || data.accounts[0] !== null || !data.accounts[1]) return 'La copia no contiene las tres cuentas de ahorro esperadas.';
    if (!Array.isArray(data.creditApplications) || !Array.isArray(data.loans) || !Array.isArray(data.limitIncreaseRequests)) return 'Faltan listas de créditos, préstamos o solicitudes.';
    if (!normalizeWithdrawalTreasury(data)) return 'El saldo o el historial de la Tesorería no son válidos.';
    if (!normalizeSimulationSettings(data)) return 'La configuración de la simulación no es válida.';
    if (!normalizeSimulationAutomation(data)) return 'La programación automática de la simulación no es válida.';
    for (const key of ['creditApplications', 'loans', 'limitIncreaseRequests']) data[key] = data[key].filter((item) => !(Number.isInteger(item?.accountId) && item.accountId === MAX_ACCOUNT_ID + 1));
    if (!backupMoneyIsValid(data.withdrawalTreasury.balance) || !Number.isSafeInteger(data.withdrawalTreasury.elapsedSeconds) || data.withdrawalTreasury.elapsedSeconds < 0 || !backupMoneyIsValid(data.withdrawalTreasury.timerIncomeTotal) || !Array.isArray(data.withdrawalTreasury.history)) return 'El saldo o el historial de la Tesorería no son válidos.';
    if (!backupMoneyIsValid(Number(data.advanceFeesCollected ?? 0)) || !backupMoneyIsValid(Number(data.operationFeesCollected ?? 0))) return 'Los acumulados de comisiones no son válidos.';
    if (data.auditLog !== undefined && (!Array.isArray(data.auditLog) || data.auditLog.length > MAX_AUDIT_EVENTS)) return 'El registro de auditoría tiene una estructura o un tamaño no válido.';
    if (Array.isArray(data.auditLog) && data.auditLog.some((event) => !event || typeof event !== 'object' || typeof event.action !== 'string' || typeof event.date !== 'string')) return 'La copia contiene eventos de auditoría dañados.';

    for (let id = 1; id <= MAX_ACCOUNT_ID; id += 1) {
      const saved = data.accounts[id];
      if (!saved || saved.id !== id || !backupMoneyIsValid(saved.balance, maxSavingsBalanceForAccount(id)) || !Array.isArray(saved.history)) {
        return `La cuenta ${id} tiene un saldo fuera del rango numérico seguro del simulador.`;
      }
      if (saved.history.length > 10000 || saved.history.some((item) => !item || typeof item !== 'object' || (item.amount !== undefined && !backupMoneyIsValid(item.amount)))) return `El historial de la cuenta ${id} contiene movimientos no válidos.`;
      const card = saved.card;
      if (!card || !backupMoneyIsValid(card.limit, MAX_CARD_LIMIT) || card.limit < MAX_CARD_FUNDS || !backupMoneyIsValid(card.funds) || !backupMoneyIsValid(Number(card.recoveredFunds ?? 0)) || !backupMoneyIsValid(Number(card.debt ?? 0)) || card.funds + Number(card.recoveredFunds ?? 0) > card.limit || !Array.isArray(card.history)
        || (card.pendingDisbursements !== undefined && (!Array.isArray(card.pendingDisbursements) || card.pendingDisbursements.some((item) => !item || typeof item.applicationId !== 'string' || !backupMoneyIsValid(item.remainingAmount) || item.remainingAmount <= 0)))) {
        return `La tarjeta de la cuenta ${id} contiene saldos, fondos o cupo no válidos.`;
      }
      if (card.history.length > 10000 || card.history.some((item) => !item || typeof item !== 'object' || (item.amount !== undefined && !backupMoneyIsValid(item.amount)))) return `El historial de tarjeta ${id} contiene movimientos no válidos.`;
    }

    for (const loan of data.loans) {
      if (!loan || typeof loan.id !== 'string' || !Number.isInteger(loan.accountId) || loan.accountId < 1 || loan.accountId > MAX_ACCOUNT_ID || !backupMoneyIsValid(loan.outstandingPrincipal) || !Array.isArray(loan.payments)) return 'La copia contiene un préstamo con datos no válidos.';
      if (loan.payments.length > 10000) return `El crédito ${loan.id} contiene demasiados pagos.`;
      for (const payment of loan.payments) {
        if (!payment || typeof payment !== 'object' || !backupMoneyIsValid(payment.amount) || !backupMoneyIsValid(payment.principal) || !backupMoneyIsValid(payment.interest) || roundMoney(payment.principal + payment.interest) !== payment.amount) return `El crédito ${loan.id} tiene un pago cuyo importe no coincide con capital e intereses.`;
      }
      for (const key of ['principalOriginal', 'originalDisbursedTotal', 'reborrowedCapitalTotal']) {
        if (loan[key] !== undefined && loan[key] !== null && !backupMoneyIsValid(loan[key])) return `El crédito ${loan.id} contiene un valor de capital inválido.`;
      }
      if (loan.termMonths !== undefined && (!Number.isInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 600)) return `El plazo del crédito ${loan.id} no es válido.`;
      if (loan.monthlyRate !== undefined && (!Number.isFinite(loan.monthlyRate) || loan.monthlyRate < 0 || loan.monthlyRate > 1)) return `La tasa del crédito ${loan.id} no es válida.`;
    }

    for (const application of data.creditApplications) {
      if (!application || typeof application.id !== 'string' || !Number.isInteger(application.accountId) || application.accountId < 1 || application.accountId > MAX_ACCOUNT_ID || !backupMoneyIsValid(application.amount) || application.amount < MIN_CREDIT_AMOUNT || typeof application.date !== 'string' || Number.isNaN(new Date(application.date).getTime())) return 'La copia contiene una solicitud de crédito no válida.';
      for (const key of ['activatedAmount', 'cardFundsRemaining']) {
        if (application[key] !== undefined && !backupMoneyIsValid(application[key])) return `La solicitud ${application.id} contiene un saldo de desembolso inválido.`;
      }
      if (application.termMonths !== undefined && (!Number.isInteger(application.termMonths) || application.termMonths < 1 || application.termMonths > 600)) return `El plazo de la solicitud ${application.id} no es válido.`;
      if (application.monthlyRate !== undefined && (!Number.isFinite(application.monthlyRate) || application.monthlyRate < 0 || application.monthlyRate > 1)) return `La tasa de la solicitud ${application.id} no es válida.`;
    }
    for (let accountId = 1; accountId <= MAX_ACCOUNT_ID; accountId += 1) {
      const entries = Array.isArray(data.accounts[accountId].card.pendingDisbursements) ? data.accounts[accountId].card.pendingDisbursements : [];
      const totalsByApplication = new Map();
      entries.forEach((entry) => totalsByApplication.set(entry.applicationId, (totalsByApplication.get(entry.applicationId) || 0) + entry.remainingAmount));
      const pendingTotal = entries.reduce((sum, entry) => sum + entry.remainingAmount, 0);
      if (pendingTotal > data.accounts[accountId].card.funds) return `Los fondos pendientes de la tarjeta ${accountId} superan el saldo disponible.`;
      for (const [applicationId, amount] of totalsByApplication) {
        const application = data.creditApplications.find((item) => item.id === applicationId && item.accountId === accountId);
        if (!application || Number(application.cardFundsRemaining) !== amount) return `El desembolso pendiente ${applicationId} no coincide con la solicitud asociada.`;
      }
      if (data.creditApplications.some((item) => item.accountId === accountId && Number(item.cardFundsRemaining) > 0 && totalsByApplication.get(item.id) !== Number(item.cardFundsRemaining))) return `La cuenta ${accountId} contiene fondos pendientes sin un registro en la tarjeta.`;
    }
    for (const request of data.limitIncreaseRequests) {
      if (!request || typeof request.id !== 'string' || !Number.isInteger(request.accountId) || request.accountId < 1 || request.accountId > MAX_ACCOUNT_ID || !backupMoneyIsValid(request.requestedLimit, MAX_CARD_LIMIT) || request.requestedLimit < MAX_CARD_FUNDS || !Number.isFinite(request.previousLimit) || typeof request.date !== 'string' || Number.isNaN(new Date(request.date).getTime())) return 'La copia contiene una solicitud de aumento de cupo no válida.';
      if (request.disbursedAmount !== undefined && !backupMoneyIsValid(request.disbursedAmount)) return `El desembolso de la solicitud de cupo ${request.id} no es válido.`;
    }
    return '';
  }

  async function exportSystemBackup() {
    if (!reviewerSession) {
      showToast('Solo el analista puede exportar una copia completa del sistema.', 'error');
      return;
    }
    try {
      recordAuditEvent('Copia de seguridad exportada', { category: 'respaldos', source: 'Analista', description: 'Exportación completa del estado del sistema con control de integridad.' });
      if (!saveDatabase()) return;
      const envelope = await makeBackupEnvelope();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `Cajero_Virtual_Copia_Seguridad_${stamp}.json`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`Copia de seguridad exportada y comprobada (${envelope.integrity.algorithm}). Guárdala en un lugar seguro.`);
    } catch (error) {
      showToast(`No se pudo exportar la copia de seguridad. ${error?.message || ''}`.trim(), 'error');
    }
  }

  async function downloadAutomaticRecoveryBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let backup;
    let filename = `Cajero_Virtual_Respaldo_Recuperacion_${timestamp}.json`;
    try {
      if (databaseLoadIssue) {
        backup = {
          format: 'cajero-virtual-recovery-snapshot',
          exportedAt: new Date().toISOString(),
          storageKey: STORAGE_KEY,
          databaseLoadIssue: true,
          rawStorage: localStorage.getItem(STORAGE_KEY)
        };
      } else {
        backup = await makeBackupEnvelope();
        filename = `Cajero_Virtual_Copia_Seguridad_${timestamp}.json`;
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { ok: true, filename };
    } catch (error) {
      return { ok: false, filename: '', error: error?.message || 'No se pudo preparar el archivo.' };
    }
  }

  async function importSystemBackupFile(file) {
    if (!reviewerSession) {
      showToast('Solo el analista puede importar una copia completa del sistema.', 'error');
      return;
    }
    if (!file) return;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      showToast('El archivo supera el tamaño máximo permitido de 15 MB.', 'error');
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(await file.text());
    } catch (error) {
      showToast('No se pudo leer el archivo. Selecciona una copia JSON válida.', 'error');
      return;
    }
    if (envelope?.format !== BACKUP_FORMAT || !SUPPORTED_BACKUP_SCHEMA_VERSIONS.includes(envelope?.schemaVersion)) {
      showToast('El archivo no es una copia de seguridad válida del Cajero Virtual.', 'error');
      return;
    }
    if (envelope.schemaVersion >= 2) {
      if (!envelope.integrity || typeof envelope.integrity.algorithm !== 'string' || typeof envelope.integrity.digest !== 'string') {
        showToast('La copia no contiene información de integridad. No se restauró ningún dato.', 'error');
        return;
      }
      try {
        const actual = await calculateBackupDigest(envelope.database, envelope.integrity.algorithm);
        if (actual.digest !== envelope.integrity.digest) {
          showToast('La copia no supera la comprobación de integridad. Puede estar dañada o haber sido modificada; no se importó.', 'error');
          return;
        }
      } catch (error) {
        showToast(`No se pudo verificar la integridad de la copia: ${error?.message || 'algoritmo no disponible'}`, 'error');
        return;
      }
    }

    const validationError = validateBackupDatabase(envelope.database);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    const transactionRevision = captureDatabaseRevision();
    const counts = `${envelope.database.loans.length} créditos, ${envelope.database.creditApplications.length} solicitudes y ${envelope.database.limitIncreaseRequests.length} solicitudes de cupo`;
    const confirmed = await showAppDialog({
      type: 'confirm',
      title: 'Restaurar copia de seguridad',
      message: `El archivo contiene ${counts}. Al continuar, reemplazarás todos los datos actuales de este navegador por los de la copia exportada el ${shortDateTime(envelope.exportedAt || '')}. ${envelope.schemaVersion >= 2 ? 'La comprobación de integridad fue correcta. ' : 'Es una copia antigua sin checksum; se validó su estructura. '}Esta acción no se puede deshacer sin otra copia. ¿Deseas continuar?`,
      eyebrow: 'IMPORTAR RESPALDO',
      icon: '!',
      confirmText: 'Restaurar datos',
      danger: true
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }

    let previousRaw = null;
    let snapshotCaptured = false;
    let installedRaw = null;
    try {
      previousRaw = localStorage.getItem(STORAGE_KEY);
      snapshotCaptured = true;
      const serialized = JSON.stringify(envelope.database);
      installedRaw = serialized;
      localStorage.setItem(STORAGE_KEY, serialized);
      lastPersistedRaw = serialized;
      databaseLoadIssue = false;
      dbRevision += 1;
      db = loadDatabase();
      databaseLoadIssue = false;
      recordAuditEvent('Copia de seguridad importada', { category: 'respaldos', source: 'Analista', description: 'La base fue restaurada desde una copia validada.', details: { schemaVersion: envelope.schemaVersion, exportedAt: envelope.exportedAt || '', loans: envelope.database.loans.length } });
      if (!saveDatabase()) throw new Error('No se pudo guardar la base restaurada.');
      if (reviewerSession) renderReviewerDashboard();
      else if (activeAccountId !== null) renderApp();
      showToast('Copia restaurada y guardada correctamente. Los datos anteriores fueron reemplazados.');
    } catch (error) {
      if (snapshotCaptured) {
        try {
          const currentRaw = localStorage.getItem(STORAGE_KEY);
          if (currentRaw === installedRaw) {
            // The failed import is still the current value: roll back to the captured snapshot.
            if (previousRaw === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, previousRaw);
            lastPersistedRaw = previousRaw;
            databaseLoadIssue = false;
          } else if (currentRaw === previousRaw) {
            // The write did not take effect; the old storage is already intact.
            lastPersistedRaw = previousRaw;
            databaseLoadIssue = false;
          } else {
            // Another tab has written a newer value. Keep it rather than restoring stale data.
            databaseLoadIssue = false;
          }
          dbRevision += 1;
          db = loadDatabase();
        } catch (rollbackError) {
          databaseLoadIssue = true;
        }
      } else {
        databaseLoadIssue = true;
      }
      if (reviewerSession) renderReviewerDashboard();
      else if (activeAccountId !== null) renderApp();
      showToast('No se pudo restaurar la copia. Se intentó recuperar el almacenamiento anterior.', 'error');
    }
  }

  const exportBackupButton = document.querySelector('#exportBackupButton');
  const importBackupButton = document.querySelector('#importBackupButton');
  const importBackupFile = document.querySelector('#importBackupFile');
  if (exportBackupButton) exportBackupButton.addEventListener('click', exportSystemBackup);
  if (importBackupButton && importBackupFile) {
    importBackupButton.addEventListener('click', () => {
      if (reviewerSession) importBackupFile.click();
      else showToast('Inicia sesión como analista para importar una copia.', 'error');
    });
    importBackupFile.addEventListener('change', async () => {
      const [file] = importBackupFile.files || [];
      importBackupFile.value = '';
      await importSystemBackupFile(file);
    });
  }
