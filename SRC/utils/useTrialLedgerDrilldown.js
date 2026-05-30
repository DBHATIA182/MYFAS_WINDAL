import { useState, useCallback } from 'react';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from './dateFormat';
import { formatLedgerVoucherApiError } from './apiLabel';

/** Ledger + voucher drill-down shared by trial reports. */
export function useTrialLedgerDrilldown({ apiBase, formData, compCode, compUid }) {
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerTitle, setLedgerTitle] = useState('');
  const [voucherRows, setVoucherRows] = useState([]);
  const [voucherTitle, setVoucherTitle] = useState('');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const ledgerDateRange = useCallback(
    (override) => {
      if (override?.sDate && override?.eDate) {
        return {
          sRaw: override.sDate,
          eRaw: override.eDate,
          sOracle: toOracleDate(override.sDate),
          eOracle: toOracleDate(override.eDate),
        };
      }
      const sRaw = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
      const eRaw = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
      return { sRaw, eRaw, sOracle: toOracleDate(sRaw), eOracle: toOracleDate(eRaw) };
    },
    [formData]
  );

  const runLedger = useCallback(
    async (code, nameHint, dateOverride) => {
      const ledgerCode = code != null && code !== '' ? String(code).trim() : '';
      if (!ledgerCode) {
        alert('No account code on this row.');
        return null;
      }
      const { sRaw, eRaw, sOracle, eOracle } = ledgerDateRange(dateOverride);
      if (!sRaw || !eRaw) {
        alert('Date range is missing. Check financial year or report dates.');
        return null;
      }
      setDrillLoading(true);
      setLedgerTitle(nameHint || ledgerCode);
      try {
        const { data } = await axios.get(`${apiBase}/api/ledger`, {
          params: {
            comp_code: compCode,
            code: ledgerCode,
            s_date: sOracle,
            e_date: eOracle,
            comp_uid: compUid,
          },
          withCredentials: true,
        });
        const rows = Array.isArray(data) ? data : [];
        setLedgerRows(rows);
        return rows;
      } catch (err) {
        alert('Error: ' + (err.response?.data?.error || err.message));
        return null;
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, compCode, compUid, ledgerDateRange]
  );

  const runLedgerVoucher = useCallback(
    async (row) => {
      const vrType = row.VR_TYPE ?? row.vr_type;
      const vrNo = row.VR_NO ?? row.vr_no;
      const vrDate = row.VR_DATE ?? row.vr_date;
      if (!vrType) {
        alert('Cannot open voucher: missing vr_type on this row.');
        return false;
      }
      const n = Number(vrNo);
      if (!Number.isFinite(n) || n <= 0) return false;
      const ymd = toInputDateString(vrDate);
      if (!ymd) {
        alert('Could not read voucher date on this line.');
        return false;
      }
      setDrillLoading(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/ledger-voucher`, {
          params: {
            comp_code: compCode,
            vr_type: String(vrType),
            vr_date: toOracleDate(ymd),
            vr_no: n,
            comp_uid: compUid,
          },
          withCredentials: true,
        });
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          alert('No voucher lines found for this voucher.');
          return false;
        }
        setVoucherRows(rows);
        setVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
        return true;
      } catch (err) {
        alert('Error: ' + formatLedgerVoucherApiError(err, apiBase));
        return false;
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, compCode, compUid]
  );

  const openLedgerSaleBill = useCallback(
    (row) => {
      const vrType = row.VR_TYPE ?? row.vr_type;
      const ledgerLineType = row.TYPE ?? row.type;
      const billNo = row.VR_NO ?? row.vr_no;
      const billDt = row.VR_DATE ?? row.vr_date;
      const ymd = toInputDateString(billDt);
      const oracleDt = toOracleDate(ymd);
      const saleType = vrType != null && String(vrType).trim() !== '' ? String(vrType).trim() : '';
      if (!saleType) {
        alert('Cannot open sale bill: missing vr_type (maps to sale.type).');
        return;
      }
      if (billNo == null || String(billNo).trim() === '' || !oracleDt) {
        alert('Cannot open sale bill: missing vr_no or vr_Date.');
        return;
      }
      const bTypeFromLedger =
        ledgerLineType != null && String(ledgerLineType).trim() !== '' ? String(ledgerLineType).trim() : ' ';
      const ptypeNum =
        typeof vrType === 'number' ? vrType : parseInt(String(vrType ?? '').trim(), 10);
      setBillPrintParams({
        type: saleType,
        ...(Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? { oracleTypeNum: ptypeNum } : {}),
        billNo: String(billNo).trim(),
        bType: bTypeFromLedger,
        oracleDt,
        compYear: String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
        label: `Sale bill — ${saleType} / ${String(billNo)} / ${toDisplayDate(ymd)}`,
      });
      setBillPrintOpen(true);
    },
    [formData]
  );

  const resetDrilldown = useCallback(() => {
    setLedgerRows([]);
    setLedgerTitle('');
    setVoucherRows([]);
    setVoucherTitle('');
  }, []);

  return {
    ledgerRows,
    ledgerTitle,
    voucherRows,
    voucherTitle,
    billPrintOpen,
    setBillPrintOpen,
    billPrintParams,
    drillLoading,
    runLedger,
    runLedgerVoucher,
    openLedgerSaleBill,
    resetDrilldown,
    ledgerDateRange,
  };
}
