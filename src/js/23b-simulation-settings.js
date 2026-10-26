  const SIMULATION_INTERVAL_CONTROLS = [
    { key: 'creditRequestIntervalSeconds', input: '#simulationCreditRequestIntervalInput', unit: '#simulationCreditRequestIntervalUnit', label: 'solicitudes de crédito' },
    { key: 'automaticCreditApprovalDelaySeconds', input: '#simulationCreditApprovalDelayInput', unit: '#simulationCreditApprovalDelayUnit', label: 'aprobación automática de créditos' },
    { key: 'automaticAdvanceDelaySeconds', input: '#simulationAdvanceDelayInput', unit: '#simulationAdvanceDelayUnit', label: 'avances automáticos' },
    { key: 'limitIncreaseRequestIntervalSeconds', input: '#simulationLimitIncreaseRequestIntervalInput', unit: '#simulationLimitIncreaseRequestIntervalUnit', label: 'solicitudes de aumento de cupo' },
    { key: 'automaticLimitIncreaseApprovalDelaySeconds', input: '#simulationLimitIncreaseApprovalDelayInput', unit: '#simulationLimitIncreaseApprovalDelayUnit', label: 'aprobación automática de aumentos de cupo' },
    { key: 'paymentInterval6Seconds', input: '#simulationPayment6IntervalInput', unit: '#simulationPayment6IntervalUnit', label: 'cuotas de créditos a 6 plazos' },
    { key: 'paymentInterval12Seconds', input: '#simulationPayment12IntervalInput', unit: '#simulationPayment12IntervalUnit', label: 'cuotas de créditos a 12 plazos' },
    { key: 'advancePaymentInterval6Seconds', input: '#simulationAdvancePayment6IntervalInput', unit: '#simulationAdvancePayment6IntervalUnit', label: 'cuotas de avances a 6 plazos' },
    { key: 'advancePaymentInterval12Seconds', input: '#simulationAdvancePayment12IntervalInput', unit: '#simulationAdvancePayment12IntervalUnit', label: 'cuotas de avances a 12 plazos' },
    { key: 'treasuryDistributionIntervalSeconds', input: '#simulationTreasuryDistributionIntervalInput', unit: '#simulationTreasuryDistributionIntervalUnit', label: 'repartos de Tesorería' },
    { key: 'automaticTransferIntervalSeconds', input: '#simulationAutomaticTransferIntervalInput', unit: '#simulationAutomaticTransferIntervalUnit', label: 'transferencias automáticas' },
    { key: 'automaticWithdrawalIntervalSeconds', input: '#simulationAutomaticWithdrawalIntervalInput', unit: '#simulationAutomaticWithdrawalIntervalUnit', label: 'retiros automáticos' }
  ];
  const SIMULATION_MAX_INTERVAL_SECONDS = 31536000;

  const SIMULATION_PROFILE_CYCLE_KEYS = [
    'creditRequestIntervalSeconds',
    'limitIncreaseRequestIntervalSeconds',
    'treasuryDistributionIntervalSeconds',
    'automaticTransferIntervalSeconds',
    'automaticWithdrawalIntervalSeconds'
  ];
  const SIMULATION_PROFILE_DEFINITIONS = {
    noche: { name: 'Noche', cycleSeconds: 8 * 60 * 60, label: '8 horas' },
    rapida: { name: 'Rápida', cycleSeconds: 8 * 60, label: '8 minutos' }
  };

  function simulationProfileWithCycle(baseSettings, cycleSeconds) {
    const settings = { ...baseSettings };
    SIMULATION_PROFILE_CYCLE_KEYS.forEach((key) => { settings[key] = cycleSeconds; });
    return settings;
  }

  function freshSimulationProfileStore(baseSettings = freshSimulationSettings()) {
    const savedAt = new Date().toISOString();
    return {
      schemaVersion: 2,
      activeProfileId: null,
      activeSettings: { ...baseSettings },
      profiles: {
        noche: { settings: simulationProfileWithCycle(baseSettings, SIMULATION_PROFILE_DEFINITIONS.noche.cycleSeconds), savedAt },
        rapida: { settings: simulationProfileWithCycle(baseSettings, SIMULATION_PROFILE_DEFINITIONS.rapida.cycleSeconds), savedAt }
      }
    };
  }

  function normalizeSimulationProfileStore(record) {
    if (record?.schemaVersion !== 2 || !record.profiles || typeof record.profiles !== 'object' || Array.isArray(record.profiles)) return null;
    const profiles = {};
    Object.keys(SIMULATION_PROFILE_DEFINITIONS).forEach((id) => {
      const savedProfile = record.profiles[id];
      if (!savedProfile || !savedProfile.settings || typeof savedProfile.settings !== 'object' || Array.isArray(savedProfile.settings)) return;
      const validation = { simulationSettings: { ...savedProfile.settings } };
      const settings = normalizeSimulationSettings(validation);
      if (settings) profiles[id] = { settings: { ...settings }, savedAt: savedProfile.savedAt || null };
    });
    const activeProfileId = Object.prototype.hasOwnProperty.call(profiles, record.activeProfileId) ? record.activeProfileId : null;
    let activeSettings = null;
    if (record.activeSettings && typeof record.activeSettings === 'object' && !Array.isArray(record.activeSettings)) {
      const validation = { simulationSettings: { ...record.activeSettings } };
      activeSettings = normalizeSimulationSettings(validation);
    }
    if (!activeSettings && activeProfileId) activeSettings = { ...profiles[activeProfileId].settings };
    return { schemaVersion: 2, activeProfileId, activeSettings: activeSettings ? { ...activeSettings } : null, profiles };
  }

  function writeSimulationProfileStore(store) {
    try {
      localStorage.setItem(SIMULATION_CONFIG_STORAGE_KEY, JSON.stringify({
        schemaVersion: 2,
        activeProfileId: store.activeProfileId || null,
        activeSettings: store.activeSettings || null,
        profiles: store.profiles || {}
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readSimulationProfileStore() {
    let raw = null;
    try { raw = localStorage.getItem(SIMULATION_CONFIG_STORAGE_KEY); } catch (error) {}
    if (raw) {
      try {
        const record = JSON.parse(raw);
        const normalized = normalizeSimulationProfileStore(record);
        if (normalized) return normalized;
        if (record?.schemaVersion === 1 && record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)) {
          const legacyValidation = { simulationSettings: { ...record.settings } };
          const legacySettings = normalizeSimulationSettings(legacyValidation);
          if (legacySettings) {
            const night = simulationProfileWithCycle(legacySettings, SIMULATION_PROFILE_DEFINITIONS.noche.cycleSeconds);
            const fast = simulationProfileWithCycle(legacySettings, SIMULATION_PROFILE_DEFINITIONS.rapida.cycleSeconds);
            const migrated = {
              schemaVersion: 2,
              activeProfileId: 'noche',
              activeSettings: { ...night },
              profiles: {
                noche: { settings: night, savedAt: record.savedAt || new Date().toISOString() },
                rapida: { settings: fast, savedAt: record.savedAt || new Date().toISOString() }
              }
            };
            writeSimulationProfileStore(migrated);
            return migrated;
          }
        }
      } catch (error) {}
    }
    const baseSettings = typeof db !== 'undefined' && db ? simulationSettingsFor(db) : freshSimulationSettings();
    const defaults = freshSimulationProfileStore(baseSettings);
    if (!raw) writeSimulationProfileStore(defaults);
    return defaults;
  }

  function readSavedSimulationConfiguration() {
    const store = readSimulationProfileStore();
    if (store.activeSettings) return { schemaVersion: 2, profileId: store.activeProfileId, settings: { ...store.activeSettings } };
    const active = store.activeProfileId ? store.profiles[store.activeProfileId] : null;
    return active ? { schemaVersion: 2, profileId: store.activeProfileId, settings: { ...active.settings } } : null;
  }

  function persistActiveSimulationConfiguration(settings = simulationSettingsFor(db)) {
    if (!db || !settings) return false;
    const store = readSimulationProfileStore();
    const savedAt = new Date().toISOString();
    store.activeSettings = { ...settings };
    if (store.activeProfileId && store.profiles[store.activeProfileId]) {
      store.profiles[store.activeProfileId] = { settings: { ...settings }, savedAt };
    }
    return writeSimulationProfileStore(store);
  }

  function setSimulationProfileStatus(profileId, message, isError = false) {
    const status = $(`#simulationProfile${profileId === 'noche' ? 'Night' : 'Fast'}Status`);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error-message', isError);
  }

  function renderSimulationProfileControls() {
    const store = readSimulationProfileStore();
    const activeStatus = $('#simulationActiveConfigStatus');
    const deleteActiveButton = $('#deleteSimulationActiveConfigButton');
    if (activeStatus) {
      activeStatus.textContent = store.activeSettings
        ? 'La configuración activa se restaurará al borrar los datos del sistema.'
        : 'No hay una copia activa; los perfiles guardados siguen disponibles para cargarlos.';
      activeStatus.classList.remove('error-message');
    }
    if (deleteActiveButton) deleteActiveButton.disabled = !store.activeSettings;
    Object.entries(SIMULATION_PROFILE_DEFINITIONS).forEach(([id, definition]) => {
      const suffix = id === 'noche' ? 'Night' : 'Fast';
      const profile = store.profiles[id];
      [`editSimulationProfile${suffix}Button`, `loadSimulationProfile${suffix}Button`, `deleteSimulationProfile${suffix}Button`]
        .forEach((elementId) => { const button = $(`#${elementId}`); if (button) button.disabled = !profile; });
      const status = $(`#simulationProfile${suffix}Status`);
      if (status) {
        status.textContent = profile
          ? `${profile.savedAt ? `Guardado: ${shortDateTime(profile.savedAt)}.` : 'Perfil disponible.'} ${store.activeProfileId === id ? 'Está aplicado actualmente.' : ''}`.trim()
          : 'Este perfil no está guardado. Usa “Guardar perfil” para crearlo.';
        status.classList.remove('error-message');
      }
    });
  }

  function setSimulationSettingsFormValues(settings, markDirty = true) {
    const form = $('#simulationSettingsForm');
    if (!form || !settings) return;
    $('#simulationMonthlyRateInput').value = String(settings.monthlyInterestRate * 100);
    $('#simulationTreasuryRateInput').value = String(settings.treasuryTimerRate);
    $('#simulationLimitIncreaseAmountInput').value = String(settings.limitIncreaseAmount);
    $('#simulationAnalystCapitalInput').value = String(settings.analystCapital);
    $('#simulationAnalystReserveInput').value = String(settings.automaticAnalystCapitalReserve);
    SIMULATION_INTERVAL_CONTROLS.forEach((control) => renderSimulationIntervalControl(control, settings[control.key]));
    $('#simulationCreditMinimumInput').value = String(settings.automaticCreditMinimumAmount);
    $('#simulationCreditMaximumInput').value = String(settings.automaticCreditMaximumAmount);
    $('#simulationAdvanceMinimumInput').value = String(settings.automaticAdvanceMinimumAmount);
    $('#simulationAdvanceMaximumInput').value = String(settings.automaticAdvanceMaximumAmount);
    $('#simulationAdvanceModeSelect').value = settings.automaticAdvanceMode;
    $('#simulationCreditTermSelect').value = String(settings.automaticCreditTermMonths);
    updateSimulationAdvanceAmountFields();
    form.dataset.dirty = markDirty ? 'true' : 'false';
  }

  function readSimulationSettingsFromForm() {
    if (!db) return null;
    const settings = {
      ...simulationSettingsFor(db),
      monthlyInterestRate: Number($('#simulationMonthlyRateInput').value) / 100,
      treasuryTimerIncomeCap: Number.MAX_SAFE_INTEGER,
      treasuryTimerRate: Number($('#simulationTreasuryRateInput').value),
      limitIncreaseAmount: Number($('#simulationLimitIncreaseAmountInput').value),
      analystCapital: Number($('#simulationAnalystCapitalInput').value),
      automaticAnalystCapitalReserve: Number($('#simulationAnalystReserveInput').value),
      automaticCreditMinimumAmount: Number($('#simulationCreditMinimumInput').value),
      automaticCreditMaximumAmount: Number($('#simulationCreditMaximumInput').value),
      automaticAdvanceMinimumAmount: Number($('#simulationAdvanceMinimumInput').value),
      automaticAdvanceMaximumAmount: Number($('#simulationAdvanceMaximumInput').value),
      automaticAdvanceMode: $('#simulationAdvanceModeSelect').value,
      automaticCreditTermMonths: Number($('#simulationCreditTermSelect').value)
    };
    if (!Number.isSafeInteger(settings.analystCapital) || settings.analystCapital < 0) return null;
    SIMULATION_INTERVAL_CONTROLS.forEach((control) => {
      const value = Number($(control.input).value);
      const multiplier = simulationIntervalUnitFactor($(control.unit).value);
      settings[control.key] = Math.round(value * multiplier);
    });
    const validation = { simulationSettings: settings };
    return normalizeSimulationSettings(validation);
  }

  function editSimulationProfile(profileId) {
    if (!reviewerSession) return;
    const definition = SIMULATION_PROFILE_DEFINITIONS[profileId];
    const profile = readSimulationProfileStore().profiles[profileId];
    if (!definition || !profile) return;
    setSimulationSettingsFormValues(profile.settings);
    $('#simulationSettingsStatus').classList.remove('error-message');
    $('#simulationSettingsStatus').textContent = `Perfil ${definition.name} cargado para editar. Guarda el perfil para actualizar su copia; usa “Guardar configuración” para aplicarlo al sistema.`;
    $('#simulationSettingsForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSimulationProfileStatus(profileId, `Valores de ${definition.name} listos en el formulario. Puedes editarlos y guardar este perfil.`, false);
  }

  function saveSimulationProfile(profileId) {
    if (!reviewerSession || !db) return;
    const definition = SIMULATION_PROFILE_DEFINITIONS[profileId];
    if (!definition) return;
    const settings = readSimulationSettingsFromForm();
    if (!settings) {
      setSimulationProfileStatus(profileId, 'Corrige los valores del formulario antes de guardar este perfil.', true);
      $('#simulationSettingsStatus').textContent = 'Hay valores inválidos. Corrígelos en el formulario y vuelve a guardar el perfil.';
      $('#simulationSettingsStatus').classList.add('error-message');
      return;
    }
    const store = readSimulationProfileStore();
    store.profiles[profileId] = { settings: { ...settings }, savedAt: new Date().toISOString() };
    if (!writeSimulationProfileStore(store)) {
      setSimulationProfileStatus(profileId, 'No se pudo guardar el perfil en el almacenamiento del navegador.', true);
      return;
    }
    setSimulationProfileStatus(profileId, `Perfil ${definition.name} guardado. No se aplicó al sistema hasta que elijas “Cargar perfil”.`, false);
    $('#simulationSettingsStatus').classList.remove('error-message');
    showToast(`Perfil ${definition.name} guardado.`);
    renderSimulationProfileControls();
    setSimulationProfileStatus(profileId, `Perfil ${definition.name} guardado. No se aplicó al sistema hasta que elijas “Cargar perfil”.`, false);
  }

  function loadSimulationProfile(profileId) {
    if (!reviewerSession || !db) return;
    const definition = SIMULATION_PROFILE_DEFINITIONS[profileId];
    const store = readSimulationProfileStore();
    const profile = store.profiles[profileId];
    if (!definition || !profile) return;
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const transactionRevision = captureDatabaseRevision();
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    const nextStore = { ...store, activeProfileId: profileId, activeSettings: { ...profile.settings } };
    if (!writeSimulationProfileStore(nextStore)) {
      setSimulationProfileStatus(profileId, 'No se pudo registrar el perfil activo en el navegador.', true);
      return;
    }
    const now = Date.now();
    const date = new Date(now).toISOString();
    db.simulationSettings = { ...profile.settings };
    db.simulationAutomation = db.simulationAutomation || freshSimulationAutomation(now, profile.settings);
    db.simulationAutomation.nextCreditRequestAt = new Date(now + profile.settings.creditRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextLimitIncreaseRequestAt = new Date(now + profile.settings.limitIncreaseRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextTreasuryDistributionAt = new Date(now + profile.settings.treasuryDistributionIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticTransferAt = new Date(now + profile.settings.automaticTransferIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticWithdrawalAt = new Date(now + profile.settings.automaticWithdrawalIntervalSeconds * 1000).toISOString();
    (Array.isArray(db.limitIncreaseRequests) ? db.limitIncreaseRequests : []).forEach((request) => {
      if ((request.status || 'En revisión') === 'En revisión') request.autoApprovalAt = new Date(now + profile.settings.automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString();
    });
    (Array.isArray(db.creditApplications) ? db.creditApplications : []).forEach((application) => {
      if (application.automaticSimulation === true && (application.status || 'En revisión') === 'En revisión') {
        application.autoApprovalAt = new Date(now + profile.settings.automaticCreditApprovalDelaySeconds * 1000).toISOString();
      }
      const queue = db.accounts?.[application.accountId]?.card?.pendingDisbursements;
      const entry = Array.isArray(queue) ? queue.find((item) => item.applicationId === application.id) : null;
      const pending = Math.max(Number(application.cardFundsRemaining) || 0, Number(entry?.remainingAmount) || 0);
      if (application.status === 'Aprobado' && pending > 0 && !application.autoAdvancedAt) {
        application.cardFundsRemaining = pending;
        application.autoAdvanceEnabled = true;
        application.autoAdvanceAt = new Date(now + profile.settings.automaticAdvanceDelaySeconds * 1000).toISOString();
      }
    });
    (Array.isArray(db.loans) ? db.loans : []).forEach((loan) => {
      if (loan?.status !== 'Activo' || Number(loan.outstandingPrincipal) <= 0) return;
      loan.automaticPaymentIntervalSeconds = automaticPaymentIntervalForTerm(loan.termMonths, db, loan.paymentScheduleType);
      loan.nextAutomaticPaymentAt = new Date(now + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
    });
    if (db.withdrawalTreasury) db.withdrawalTreasury.lastAccruedAt = date;
    recordAuditEvent('Perfil de automatización cargado', {
      category: 'sistema', source: 'Analista',
      description: `Se aplicó el perfil ${definition.name} (${definition.label}) desde las configuraciones independientes.`,
      details: { profileId, savedAt: profile.savedAt || null }, date
    });
    if (!saveDatabase()) {
      setSimulationProfileStatus(profileId, 'El perfil se seleccionó, pero no se pudo guardar la configuración activa.', true);
      return;
    }
    $('#simulationSettingsForm').dataset.dirty = 'false';
    renderSimulationSettingsPanel();
    renderReviewerDashboard();
    renderSimulationProfileControls();
    setSimulationProfileStatus(profileId, `Perfil ${definition.name} cargado y aplicado. Quedará activo tras borrar los datos del sistema.`, false);
    showToast(`Perfil ${definition.name} cargado.`);
  }

  async function deleteSimulationProfile(profileId) {
    if (!reviewerSession) return;
    const definition = SIMULATION_PROFILE_DEFINITIONS[profileId];
    const store = readSimulationProfileStore();
    if (!definition || !store.profiles[profileId]) {
      setSimulationProfileStatus(profileId, 'No hay un perfil guardado para eliminar.', false);
      return;
    }
    const confirmed = await showAppDialog({
      type: 'confirm', title: `Eliminar perfil ${definition.name}`,
      message: `Se eliminará solo la copia del perfil ${definition.name}. La configuración activa y el otro perfil no cambiarán.`,
      eyebrow: 'CONFIGURACIÓN GUARDADA', icon: '!', confirmText: 'Eliminar perfil', danger: true
    });
    if (!confirmed) return;
    delete store.profiles[profileId];
    if (store.activeProfileId === profileId) {
      store.activeProfileId = null;
      store.activeSettings = null;
    }
    if (!writeSimulationProfileStore(store)) {
      setSimulationProfileStatus(profileId, 'El navegador no permitió eliminar la copia del perfil.', true);
      return;
    }
    renderSimulationProfileControls();
    setSimulationProfileStatus(profileId, `Perfil ${definition.name} eliminado. La configuración activa no cambió.`, false);
    showToast(`Perfil ${definition.name} eliminado.`);
  }

  async function deletePersistedActiveSimulationConfiguration() {
    if (!reviewerSession) return;
    const store = readSimulationProfileStore();
    if (!store.activeSettings) {
      showToast('No hay una configuración activa guardada para eliminar.');
      return;
    }
    const confirmed = await showAppDialog({
      type: 'confirm', title: 'Eliminar configuración activa guardada',
      message: 'Se borrará la copia de los ajustes activos que se restaura después de borrar los datos del sistema. Los perfiles Noche y Rápida no se modificarán.',
      eyebrow: 'CONFIGURACIÓN PERSISTENTE', icon: '!', confirmText: 'Eliminar copia activa', danger: true
    });
    if (!confirmed) return;
    store.activeSettings = null;
    store.activeProfileId = null;
    if (!writeSimulationProfileStore(store)) {
      $('#simulationActiveConfigStatus').textContent = 'El navegador no permitió eliminar la copia activa.';
      $('#simulationActiveConfigStatus').classList.add('error-message');
      return;
    }
    renderSimulationProfileControls();
    $('#simulationActiveConfigStatus').textContent = 'Copia activa eliminada. Los perfiles guardados y los ajustes actuales no cambiaron.';
    $('#simulationActiveConfigStatus').classList.remove('error-message');
    showToast('Copia activa eliminada.');
  }

  function simulationIntervalUnitFactor(unit) {
    if (unit === 'hours') return 3600;
    if (unit === 'minutes') return 60;
    return 1;
  }

  function updateSimulationIntervalInputLimit(control) {
    const input = $(control.input);
    const unit = $(control.unit);
    if (!input || !unit) return;
    const factor = simulationIntervalUnitFactor(unit.value);
    input.min = String(1 / factor);
    input.max = String(SIMULATION_MAX_INTERVAL_SECONDS / factor);
    input.step = 'any';
  }

  function renderSimulationIntervalControl(control, seconds) {
    const input = $(control.input);
    const unit = $(control.unit);
    const displayHours = seconds % 3600 === 0;
    const displayMinutes = seconds % 60 === 0;
    const displayUnit = displayHours ? 'hours' : (displayMinutes ? 'minutes' : 'seconds');
    if (unit) {
      unit.value = displayUnit;
      unit.dataset.previousUnit = unit.value;
    }
    if (input) input.value = String(seconds / simulationIntervalUnitFactor(displayUnit));
    updateSimulationIntervalInputLimit(control);
  }

  function convertSimulationIntervalUnit(control) {
    const input = $(control.input);
    const unit = $(control.unit);
    if (!input || !unit) return;
    const oldUnit = unit.dataset.previousUnit || unit.value;
    const newUnit = unit.value;
    const oldFactor = simulationIntervalUnitFactor(oldUnit);
    const newFactor = simulationIntervalUnitFactor(newUnit);
    const currentValue = Number(input.value);
    if (Number.isFinite(currentValue)) input.value = String(currentValue * oldFactor / newFactor);
    unit.dataset.previousUnit = newUnit;
    updateSimulationIntervalInputLimit(control);
  }

  function renderSimulationSettingsPanel() {
    const form = $('#simulationSettingsForm');
    if (!form || !db) return;
    const paused = db.simulationAutomation?.paused === true;
    const pauseButton = $('#toggleSimulationAutomationButton');
    const pauseState = $('#simulationAutomationState');
    if (pauseButton) {
      pauseButton.textContent = paused ? 'Reanudar automatización' : 'Pausar automatización';
      pauseButton.setAttribute('aria-pressed', String(paused));
      pauseButton.classList.toggle('button-secondary', paused);
      pauseButton.classList.toggle('button-primary', !paused);
    }
    if (pauseState) {
      pauseState.textContent = paused ? 'Automatización pausada' : 'Automatización activa';
      pauseState.dataset.paused = String(paused);
    }
    if (form.dataset.dirty === 'true' || form.contains(document.activeElement)) return;
    const settings = simulationSettingsFor(db);
    setSimulationSettingsFormValues(settings, false);
    renderSimulationProfileControls();
  }

  function markSimulationSettingsDirty(event) {
    if (event?.target?.id === 'simulationAnalystCapitalInput') return;
    const form = $('#simulationSettingsForm');
    if (form) form.dataset.dirty = 'true';
  }

  function updateSimulationAdvanceAmountFields() {
    const useRange = $('#simulationAdvanceModeSelect')?.value === 'range';
    ['#simulationAdvanceMinimumInput', '#simulationAdvanceMaximumInput'].forEach((selector) => {
      const input = $(selector);
      if (input) input.disabled = !useRange;
    });
  }

  function saveSimulationSettings(event) {
    event.preventDefault();
    if (!reviewerSession || !db) return;
    const status = $('#simulationSettingsStatus');
    const values = {
      monthlyInterestRate: Number($('#simulationMonthlyRateInput').value) / 100,
      treasuryTimerIncomeCap: Number.MAX_SAFE_INTEGER,
      treasuryTimerRate: Number($('#simulationTreasuryRateInput').value),
      limitIncreaseAmount: Number($('#simulationLimitIncreaseAmountInput').value),
      automaticAnalystCapitalReserve: Number($('#simulationAnalystReserveInput').value),

      automaticCreditMinimumAmount: Number($('#simulationCreditMinimumInput').value),
      automaticCreditMaximumAmount: Number($('#simulationCreditMaximumInput').value),
      automaticAdvanceMinimumAmount: Number($('#simulationAdvanceMinimumInput').value),
      automaticAdvanceMaximumAmount: Number($('#simulationAdvanceMaximumInput').value),
      automaticAdvanceMode: $('#simulationAdvanceModeSelect').value,
      automaticCreditTermMonths: Number($('#simulationCreditTermSelect').value)
    };
    const fail = (message, selector) => {
      status.textContent = message;
      status.classList.add('error-message');
      $(selector).focus();
    };
    status.classList.remove('error-message');
    if (!Number.isFinite(values.monthlyInterestRate) || values.monthlyInterestRate < 0 || values.monthlyInterestRate > 1) {
      fail('La tasa debe estar entre 0 % y 100 % mensual.', '#simulationMonthlyRateInput');
      return;
    }
    if (!Number.isSafeInteger(values.limitIncreaseAmount) || values.limitIncreaseAmount < MIN_CREDIT_AMOUNT || values.limitIncreaseAmount % MIN_CREDIT_AMOUNT !== 0) {
      fail('El saldo de cada aumento debe ser un importe entero de al menos $100.000, en incrementos de $100.000.', '#simulationLimitIncreaseAmountInput');
      return;
    }
    if (!Number.isSafeInteger(values.automaticAnalystCapitalReserve) || values.automaticAnalystCapitalReserve < 0) {
      fail('La reserva automática debe ser un saldo entero no negativo.', '#simulationAnalystReserveInput');
      return;
    }
    if (!Number.isSafeInteger(values.treasuryTimerRate) || values.treasuryTimerRate < 1) {
      fail('El cronómetro debe sumar al menos $1 entero por segundo.', '#simulationTreasuryRateInput');
      return;
    }
    for (const control of SIMULATION_INTERVAL_CONTROLS) {
      const rawValue = Number($(control.input).value);
      const multiplier = simulationIntervalUnitFactor($(control.unit).value);
      const seconds = Math.round(rawValue * multiplier);
      if (!Number.isFinite(rawValue) || rawValue <= 0 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > SIMULATION_MAX_INTERVAL_SECONDS) {
        fail('El intervalo de ' + control.label + ' debe ser de 1 segundo a 1 año.', control.input);
        return;
      }
      values[control.key] = seconds;
    }
    const amountFields = [
      ['automaticCreditMinimumAmount', '#simulationCreditMinimumInput', 'monto mínimo del crédito'],
      ['automaticCreditMaximumAmount', '#simulationCreditMaximumInput', 'monto máximo del crédito'],
      ['automaticAdvanceMinimumAmount', '#simulationAdvanceMinimumInput', 'monto mínimo del avance'],
      ['automaticAdvanceMaximumAmount', '#simulationAdvanceMaximumInput', 'monto máximo del avance']
    ];
    for (const [key, selector, label] of amountFields) {
      const amount = values[key];
      if (!Number.isSafeInteger(amount) || amount < MIN_CREDIT_AMOUNT || amount > MAX_CREDIT_AMOUNT || amount % MIN_CREDIT_AMOUNT !== 0) {
        fail('El ' + label + ' debe estar entre $100.000 y $100.000.000, en incrementos de $100.000.', selector);
        return;
      }
    }
    if (values.automaticCreditMinimumAmount > values.automaticCreditMaximumAmount) {
      fail('El monto mínimo del crédito no puede superar el máximo.', '#simulationCreditMinimumInput');
      return;
    }
    if (values.automaticAdvanceMinimumAmount > values.automaticAdvanceMaximumAmount) {
      fail('El monto mínimo del avance no puede superar el máximo.', '#simulationAdvanceMinimumInput');
      return;
    }
    if (!['credit_amount', 'range'].includes(values.automaticAdvanceMode)) {
      fail('Elige avance completo o un rango personalizado.', '#simulationAdvanceModeSelect');
      return;
    }
    if (values.automaticAdvanceMinimumAmount > values.automaticCreditMinimumAmount
      || values.automaticAdvanceMaximumAmount > values.automaticCreditMaximumAmount) {
      fail('Los montos de avance deben quedar dentro del rango de los créditos.', '#simulationAdvanceMinimumInput');
      return;
    }
    if (![0, ...VALID_CREDIT_TERMS].includes(values.automaticCreditTermMonths)) {
      fail('Elige un plazo aleatorio o un plazo entre 6 y 60 meses, en intervalos de 6 meses.', '#simulationCreditTermSelect');
      return;
    }
    const transactionRevision = captureDatabaseRevision();
    if (!isDatabaseRevisionCurrent(transactionRevision)) {
      abortStaleFinancialOperation();
      return;
    }
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    accrueWithdrawalTreasury(db);
    const updatedAtMs = Date.now();
    const updatedAt = new Date(updatedAtMs).toISOString();
    db.simulationSettings = { ...simulationSettingsFor(db), ...values };
    db.simulationAutomation.nextCreditRequestAt = new Date(updatedAtMs + values.creditRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextLimitIncreaseRequestAt = new Date(updatedAtMs + values.limitIncreaseRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextTreasuryDistributionAt = new Date(updatedAtMs + values.treasuryDistributionIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticTransferAt = new Date(updatedAtMs + values.automaticTransferIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticWithdrawalAt = new Date(updatedAtMs + values.automaticWithdrawalIntervalSeconds * 1000).toISOString();
    (Array.isArray(db.limitIncreaseRequests) ? db.limitIncreaseRequests : []).forEach((request) => {
      if ((request.status || 'En revisión') !== 'En revisión') return;
      request.autoApprovalAt = new Date(updatedAtMs + values.automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString();
    });
    (Array.isArray(db.creditApplications) ? db.creditApplications : []).forEach((application) => {
      if (application.automaticSimulation === true && (application.status || 'En revisión') === 'En revisión') {
        application.autoApprovalAt = new Date(updatedAtMs + values.automaticCreditApprovalDelaySeconds * 1000).toISOString();
      } else if (application.status === 'Aprobado' && Number(application.cardFundsRemaining) > 0 && !application.autoAdvancedAt) {
        application.autoAdvanceEnabled = true;
        application.autoAdvanceAt = new Date(updatedAtMs + values.automaticAdvanceDelaySeconds * 1000).toISOString();
      }
    });
    for (const loan of (Array.isArray(db.loans) ? db.loans : [])) {
      if (loan?.status !== 'Activo' || Number(loan.outstandingPrincipal) <= 0) continue;
      loan.automaticPaymentIntervalSeconds = automaticPaymentIntervalForTerm(loan.termMonths, db, loan.paymentScheduleType);
      loan.nextAutomaticPaymentAt = new Date(updatedAtMs + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
    }
    db.withdrawalTreasury.lastAccruedAt = updatedAt;
    recordAuditEvent('Configuración de simulación actualizada', {
      category: 'sistema', source: 'Analista',
      description: 'Se actualizaron intervalos, montos, plazos y valores del cronómetro.',
      details: { ...values }
    });
    if (!saveDatabase()) {
      renderSimulationSettingsPanel();
      return;
    }
    const snapshotSaved = persistActiveSimulationConfiguration(db.simulationSettings);
    $('#simulationSettingsForm').dataset.dirty = 'false';
    renderSimulationSettingsPanel();
    if (typeof renderFinancialAuditPanel === 'function') renderFinancialAuditPanel();
    if (typeof renderMonthlyFinancialReport === 'function') renderMonthlyFinancialReport();
    status.textContent = snapshotSaved
      ? 'Configuración guardada. Los próximos eventos y pagos ya usan estos valores y se restaurarán tras borrar los datos.'
      : 'Configuración activa guardada, pero no se pudo actualizar su copia independiente.';
    showToast('Configuración de simulación actualizada.');
  }

  function saveAnalystCapital() {
    if (!reviewerSession || !db) return;
    const input = $('#simulationAnalystCapitalInput');
    const status = $('#simulationAnalystCapitalStatus');
    const amount = Number(input?.value);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      status.textContent = 'Ingresa un saldo entero no negativo dentro del rango seguro del navegador.';
      status.classList.add('error-message');
      input?.focus();
      return;
    }
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const transactionRevision = captureDatabaseRevision();
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    db.simulationSettings = { ...simulationSettingsFor(db), analystCapital: amount };
    recordAuditEvent('Capital base del analista actualizado', {
      category: 'sistema', source: 'Analista', amount,
      description: `Se configuró el capital base del analista en ${money(amount)}.`
    });
    if (!saveDatabase()) return;
    const snapshotSaved = persistActiveSimulationConfiguration(db.simulationSettings);
    status.classList.remove('error-message');
    status.textContent = `Saldo base guardado: ${money(amount)}. El total también incluye intereses y comisiones cobradas.${snapshotSaved ? ' Se conservará al borrar los datos del sistema.' : ' No se pudo actualizar la copia independiente.'}`;
    renderSimulationSettingsPanel();
    if (typeof renderReviewerDashboard === 'function') renderReviewerDashboard();
    if (typeof renderFinancialAuditPanel === 'function') renderFinancialAuditPanel();
    if (typeof renderMonthlyFinancialReport === 'function') renderMonthlyFinancialReport();
    showToast('Saldo del analista actualizado.');
  }
  SIMULATION_INTERVAL_CONTROLS.forEach((control) => {
    $(control.input)?.addEventListener('input', markSimulationSettingsDirty);
    $(control.unit)?.addEventListener('change', () => {
      convertSimulationIntervalUnit(control);
      markSimulationSettingsDirty();
    });
  });
  $('#simulationSettingsForm')?.addEventListener('input', markSimulationSettingsDirty);
  $('#simulationSettingsForm')?.addEventListener('change', markSimulationSettingsDirty);
  $('#simulationAdvanceModeSelect')?.addEventListener('change', updateSimulationAdvanceAmountFields);
  $('#simulationSettingsForm')?.addEventListener('submit', saveSimulationSettings);
  $('#saveAnalystCapitalButton')?.addEventListener('click', saveAnalystCapital);
  $('#deleteSimulationActiveConfigButton')?.addEventListener('click', deletePersistedActiveSimulationConfiguration);
  $('#editSimulationProfileNightButton')?.addEventListener('click', () => editSimulationProfile('noche'));
  $('#saveSimulationProfileNightButton')?.addEventListener('click', () => saveSimulationProfile('noche'));
  $('#loadSimulationProfileNightButton')?.addEventListener('click', () => loadSimulationProfile('noche'));
  $('#deleteSimulationProfileNightButton')?.addEventListener('click', () => deleteSimulationProfile('noche'));
  $('#editSimulationProfileFastButton')?.addEventListener('click', () => editSimulationProfile('rapida'));
  $('#saveSimulationProfileFastButton')?.addEventListener('click', () => saveSimulationProfile('rapida'));
  $('#loadSimulationProfileFastButton')?.addEventListener('click', () => loadSimulationProfile('rapida'));
  $('#deleteSimulationProfileFastButton')?.addEventListener('click', () => deleteSimulationProfile('rapida'));
