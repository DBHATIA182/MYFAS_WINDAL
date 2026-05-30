import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import {
  buildProductionListDisplayEntries,
  sumProductionListGrandTotals,
} from '../utils/productionListGrouping';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapRow(r) {
  const sd = r.S_DATE ?? r.s_date;
  return {
    S_DATE: toDisplayDate(toInputDateString(sd)),
    S_NO: r.S_NO ?? r.s_no,
    ITEM: r.ITEM ?? r.item,
    MILL_ITEM_NAME: r.MILL_ITEM_NAME ?? r.mill_item_name ?? '',
    MILLING: Number(r.MILLING ?? r.milling ?? 0),
    M_QNTY: Number(r.M_QNTY ?? r.m_qnty ?? 0),
    M_STATUS: r.M_STATUS ?? r.m_status,
    TRN_NO: r.TRN_NO ?? r.trn_no,
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    LINE_ITEM_NAME: r.LINE_ITEM_NAME ?? r.line_item_name ?? '',
    PROD_PER: Number(r.PROD_PER ?? r.prod_per ?? 0),
    QNTY: Number(r.QNTY ?? r.qnty ?? 0),
    STATUS: r.STATUS ?? r.status,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0),
    SHORT: Number(r.SHORT ?? r.short ?? 0),
    PLANT_CODE: r.PLANT_CODE ?? r.plant_code,
    _rawDate: sd,
  };
}

export default function ProductionListScreen({ apiBase, formData, onClose, onOpenVoucher }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDate, setSDate] = useState(() => toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [eDate, setEDate] = useState(() => toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const reportRows = useMemo(() => rows.map(mapRow), [rows]);

  const displayEntries = useMemo(() => buildProductionListDisplayEntries(reportRows), [reportRows]);

  const totals = useMemo(() => sumProductionListGrandTotals(reportRows), [reportRows]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
    }),
    [compName, sDate, eDate]
  );

  const excelRows = useMemo(
    () =>
      reportRows.map((r) => ({
        Date: r.S_DATE,
        SrNo: r.S_NO,
        MItem: r.ITEM,
        MItemName: r.MILL_ITEM_NAME,
        MWeight: r.MILLING,
        MQty: r.M_QNTY,
        MBKH: r.M_STATUS,
        Sno: r.TRN_NO,
        Item: r.ITEM_CODE,
        ItemName: r.LINE_ITEM_NAME,
        ProdPct: r.PROD_PER,
        PQty: r.QNTY,
        PBKH: r.STATUS,
        PWeight: r.WEIGHT,
        PShort: r.SHORT,
        Plant: r.PLANT_CODE,
      })),
    [reportRows]
  );

  const runReport = async () => {
    setErr('');
    if (!sDate || !eDate) {
      setErr('Starting and ending dates are required.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/production-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date_from: toOracleDate(sDate),
          s_date_to: toOracleDate(eDate),
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'List failed');
    } finally {
      setLoading(false);
    }
  };

  const fmt3 = (n) => (Number(n) ? Number(n).toFixed(3) : '');

  return (
    <div className="slide slide-32-production-list dc-list-screen">
      <DcActionBar position="top">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          ← Back
        </button>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
          {loading ? 'Loading…' : 'Run list'}
        </button>
        <button
          type="button"
          className="btn btn-export"
          disabled={!reportRows.length}
          onClick={() => generatePDF('production-list', { rows: reportRows }, pdfMeta).catch((e) => alert(e?.message || String(e)))}
        >
          PDF
        </button>
        <button
          type="button"
          className="btn btn-export"
          disabled={!reportRows.length}
          onClick={() => downloadExcelRows(excelRows, 'ProductionList', `${compName}_Production_List`)}
        >
          Excel
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!reportRows.length}
          onClick={() =>
            sharePdfWithWhatsApp('production-list', { rows: reportRows }, pdfMeta, `${compName}\nProduction list`).catch(
              (e) => alert(e?.message || String(e))
            )
          }
        >
          WhatsApp
        </button>
      </DcActionBar>

      <header className="dc-list-screen__head">
        <h2>Production records — list</h2>
        <div className="dc-list-filters">
          <label>
            From
            <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </label>
        </div>
      </header>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="dc-list-table-wrap prod-list-table-wrap">
        <table className="report-table prod-list-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>SrNo</th>
              <th>M.Item</th>
              <th>M.Item name</th>
              <th className="amount">M.Weight</th>
              <th className="amount">M.Qty</th>
              <th>B/K/H</th>
              <th>Sno</th>
              <th>Item</th>
              <th>Item name</th>
              <th className="amount">Prod%</th>
              <th className="amount">P.Qty</th>
              <th>B/K/H</th>
              <th className="amount">P.Weight</th>
              <th className="amount">P.Short</th>
              <th>Plant</th>
            </tr>
          </thead>
          <tbody>
            {reportRows.length === 0 ? (
              <tr>
                <td colSpan={16}>{loading ? 'Loading…' : 'Run list to load rows.'}</td>
              </tr>
            ) : (
              displayEntries.map((ent, i) => {
                if (ent.kind === 'hr') {
                  return (
                    <tr key={`hr-${i}`} className="prod-list-hr-row" aria-hidden="true">
                      <td colSpan={16}>
                        <hr className="prod-list-hr" />
                      </td>
                    </tr>
                  );
                }
                if (ent.kind === 'subtotal') {
                  return (
                    <tr key={`sub-${ent.S_DATE}-${ent.S_NO}-${i}`} className="prod-list-voucher-total">
                      <td>{ent.S_DATE}</td>
                      <td>{ent.S_NO}</td>
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td className="amount">{fmt3(ent.mW)}</td>
                      <td className="amount">{fmt3(ent.mQ)}</td>
                      <td />
                      <td colSpan={3} />
                      <td className="amount">{fmt3(ent.pQ)}</td>
                      <td />
                      <td className="amount">{fmt3(ent.pW)}</td>
                      <td className="amount">{fmt3(ent.pS)}</td>
                      <td />
                    </tr>
                  );
                }
                const r = ent.row;
                return (
                  <tr
                    key={`${r.S_DATE}-${r.S_NO}-${r.TRN_NO}-${i}`}
                    className="prod-list-row-clickable"
                    onClick={() =>
                      onOpenVoucher?.({
                        s_date: toOracleDate(toInputDateString(r._rawDate)),
                        s_no: r.S_NO,
                      })
                    }
                    title="Open voucher"
                  >
                    <td>{r.S_DATE}</td>
                    <td>{r.S_NO}</td>
                    <td>{r.ITEM}</td>
                    <td>{r.MILL_ITEM_NAME}</td>
                    <td className="amount">{fmt3(r.MILLING)}</td>
                    <td className="amount">{fmt3(r.M_QNTY)}</td>
                    <td>{r.M_STATUS}</td>
                    <td>{r.TRN_NO}</td>
                    <td>{r.ITEM_CODE}</td>
                    <td>{r.LINE_ITEM_NAME}</td>
                    <td className="amount">{fmt3(r.PROD_PER)}</td>
                    <td className="amount">{fmt3(r.QNTY)}</td>
                    <td>{r.STATUS}</td>
                    <td className="amount">{fmt3(r.WEIGHT)}</td>
                    <td className="amount">{fmt3(r.SHORT)}</td>
                    <td>{r.PLANT_CODE}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {reportRows.length > 0 ? (
            <tfoot>
              <tr className="prod-list-hr-row" aria-hidden="true">
                <td colSpan={16}>
                  <hr className="prod-list-hr prod-list-hr--grand" />
                </td>
              </tr>
              <tr className="report-grand-total">
                <td colSpan={2}>Grand total</td>
                <td colSpan={2} />
                <td className="amount">{fmt3(totals.mW)}</td>
                <td className="amount">{fmt3(totals.mQ)}</td>
                <td colSpan={5} />
                <td className="amount">{fmt3(totals.pQ)}</td>
                <td />
                <td className="amount">{fmt3(totals.pW)}</td>
                <td className="amount">{fmt3(totals.pS)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
