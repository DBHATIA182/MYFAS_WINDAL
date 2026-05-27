import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import VoucherReportPreviewModal from './VoucherReportPreviewModal';
import {
  defaultDocDateInFinYear,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import {
  formatLedgerDateDisplay,
  toDisplayDate,
  toInputDateString,
  toOracleDate,
} from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rowKey(r, idx) {
  const vt = r.VR_TYPE ?? r.vr_type ?? '';
  const vd = r.VR_DATE ?? r.vr_date ?? '';
  const no = r.VR_NO ?? r.vr_no ?? '';
  const trn = r.TRN_NO ?? r.trn_no ?? idx;
  return `${vt}-${vd}-${no}-${trn}-${idx}`;
}

export default function VoucherEntryListScreen({ apiBase, formData, defaultVrType, onClose, onOpenVoucher }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const finYear = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);

  const [startDate, setStartDate] = useState(() => finYear.fyMinYmd || toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [endDate, setEndDate] = useState(() =>
    defaultDocDateInFinYear(finYear.fyMinYmd, finYear.fyMaxYmd) || toInputDateString(new Date())
  );
  const [vrType, setVrType] = useState(defaultVrType || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);

  const topScrollRef = useRef(null);
  const topInnerRef = useRef(null);
  const gridScrollRef = useRef(null);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const r of rows) {
      dr += Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
      cr += Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    }
    return { dr, cr };
  }, [rows]);

  const vrTypeLabel = vrType === 'CV' ? 'CV — Cash' : vrType === 'BV' ? 'BV — Bank' : vrType === 'JV' ? 'JV — Journal' : 'All';

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(startDate),
      endDate: toDisplayDate(endDate),
      vrTypeLabel,
    }),
    [compName, startDate, endDate, vrTypeLabel]
  );

  const shareText = [
    compName,
    'Voucher list',
    `${toDisplayDate(startDate)} to ${toDisplayDate(endDate)}`,
    vrType ? `Type: ${vrType}` : 'All types',
  ].join('\n');

  const excelRows = useMemo(
    () =>
      rows.map((r) => ({
        VrType: r.VR_TYPE ?? r.vr_type,
        VrDate: formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date),
        VrNo: r.VR_NO ?? r.vr_no,
        Type: r.TYPE ?? r.type,
        Code: r.CODE ?? r.code,
        Name: r.NAME ?? r.name,
        DrAmt: r.DR_AMT ?? r.dr_amt,
        CrAmt: r.CR_AMT ?? r.cr_amt,
        BillDate: formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date),
        BillNo: r.BILL_NO ?? r.bill_no,
        BType: r.B_TYPE ?? r.b_type,
        ChqNo: r.CHQ_NO ?? r.chq_no,
        Detail: r.DETAIL ?? r.detail,
        DcCode: r.DC_CODE ?? r.dc_code,
      })),
    [rows]
  );

  const hasRows = rows.length > 0;

  useEffect(() => {
    if (!ran || !rows.length) return;
    const top = topScrollRef.current;
    const topInner = topInnerRef.current;
    const grid = gridScrollRef.current;
    if (!top || !topInner || !grid) return;

    let syncingFromTop = false;
    let syncingFromGrid = false;

    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };

    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };

    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };

    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);

    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
    };
  }, [ran, rows]);

  const runList = async () => {
    const sDate = toOracleDate(startDate);
    const eDate = toOracleDate(endDate);
    if (!sDate || !eDate) {
      alert('Choose start and end date.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/voucher-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vrType || undefined,
          s_date: sDate,
          e_date: eDate,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'List failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const openRow = (r) => {
    const ymd = toInputDateString(r.VR_DATE ?? r.vr_date);
    onOpenVoucher?.({
      vr_type: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
      vr_date: ymd,
      vr_no: r.VR_NO ?? r.vr_no,
      type: String(r.TYPE ?? r.type ?? 'N').trim().toUpperCase(),
    });
  };

  const listExportButtons = (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!hasRows}
        onClick={() => setReportPreviewOpen(true)}
      >
        Print
      </button>
      <button
        type="button"
        className="btn btn-export"
        disabled={!hasRows}
        onClick={() =>
          generatePDF('voucher-list', { rows }, pdfMeta).catch((e) => alert(e?.message || String(e)))
        }
      >
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!hasRows}
        onClick={() => downloadExcelRows(excelRows, 'VoucherList', `${compName || 'Company'}_VoucherList`)}
      >
        Excel
      </button>
      <button
        type="button"
        className="btn btn-whatsapp"
        disabled={!hasRows}
        title={hasRows ? 'Share list as PDF on WhatsApp' : 'Run list first'}
        onClick={() =>
          sharePdfWithWhatsApp('voucher-list', { rows }, pdfMeta, shareText).catch((e) =>
            alert(e?.message || String(e))
          )
        }
      >
        WhatsApp
      </button>
    </>
  );

  return (
    <div className="slide slide-28-voucher-list sale-bill-page sale-entry-desktop">
      <div className="report-toolbar voucher-entry-list-toolbar">
        <h2 className="sale-bill-page__title">Voucher list</h2>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            ← Back to entry
          </button>
          {ran ? listExportButtons : null}
        </div>
      </div>

      <SessionInfoLine formData={formData} helpReportId="voucher-list" />

      <div className="voucher-entry-list-filters">
        <label className="voucher-entry-field">
          <span>From date</span>
          <input className="form-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="voucher-entry-field">
          <span>To date</span>
          <input className="form-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="voucher-entry-field">
          <span>Voucher type</span>
          <select className="form-input" value={vrType} onChange={(e) => setVrType(e.target.value)}>
            <option value="">All</option>
            <option value="CV">CV — Cash</option>
            <option value="BV">BV — Bank</option>
            <option value="JV">JV — Journal</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void runList()} disabled={loading}>
          {loading ? 'Loading…' : 'View list'}
        </button>
        {ran ? listExportButtons : null}
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="voucher-entry-list-grid-wrap">
        <div className="sale-list-scroll-sync sale-list-scroll-sync--top voucher-entry-list-scroll-top" ref={topScrollRef} aria-hidden="true">
          <div className="sale-list-scroll-sync-inner" ref={topInnerRef} />
        </div>
        <div className="table-responsive table-responsive--voucher-list voucher-entry-list-grid" ref={gridScrollRef}>
          <table className="report-table report-table--voucher-list voucher-entry-list-table">
            <thead>
              <tr>
                <th>Vr type</th>
                <th>Vr date</th>
                <th>Vr no</th>
                <th>Type</th>
                <th>Code</th>
                <th>Name</th>
                <th className="text-right">Dr amt</th>
                <th className="text-right">Cr amt</th>
                <th>Bill date</th>
                <th>Bill no</th>
                <th>B type</th>
                <th>Chq no</th>
                <th>Detail</th>
                <th>Dc code</th>
              </tr>
            </thead>
            <tbody>
              {!ran ? (
                <tr>
                  <td colSpan={14} className="voucher-entry-list-empty">
                    Set dates and click View list.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="voucher-entry-list-empty">
                    No vouchers in this range.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr
                    key={rowKey(r, idx)}
                    className="sale-list-row-clickable"
                    onClick={() => openRow(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRow(r);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    title="Open voucher in entry"
                  >
                    <td>{r.VR_TYPE ?? r.vr_type ?? '—'}</td>
                    <td>{formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date)}</td>
                    <td>{r.VR_NO ?? r.vr_no ?? '—'}</td>
                    <td>{r.TYPE ?? r.type ?? '—'}</td>
                    <td>{r.CODE ?? r.code ?? '—'}</td>
                    <td>{r.NAME ?? r.name ?? '—'}</td>
                    <td className="text-right">{fmtAmt(r.DR_AMT ?? r.dr_amt)}</td>
                    <td className="text-right">{fmtAmt(r.CR_AMT ?? r.cr_amt)}</td>
                    <td>{formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date)}</td>
                    <td>{r.BILL_NO ?? r.bill_no ?? '—'}</td>
                    <td>{r.B_TYPE ?? r.b_type ?? '—'}</td>
                    <td>{r.CHQ_NO ?? r.chq_no ?? '—'}</td>
                    <td className="voucher-entry-list-detail">{r.DETAIL ?? r.detail ?? '—'}</td>
                    <td>{r.DC_CODE ?? r.dc_code ?? '—'}</td>
                  </tr>
                ))
              )}
              {rows.length > 0 ? (
                <tr className="bill-ledger-grand-total">
                  <td colSpan={6}>
                    <strong>GRAND TOTAL ({rows.length} lines)</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.dr)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAmt(totals.cr)}</strong>
                  </td>
                  <td colSpan={6}>—</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {ran && hasRows ? (
        <div className="voucher-entry-list-mobile-actions" aria-label="Export actions">
          <button type="button" className="btn btn-secondary" onClick={() => setReportPreviewOpen(true)}>
            Print
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            onClick={() =>
              sharePdfWithWhatsApp('voucher-list', { rows }, pdfMeta, shareText).catch((e) =>
                alert(e?.message || String(e))
              )
            }
          >
            WhatsApp
          </button>
        </div>
      ) : null}

      <VoucherReportPreviewModal
        open={reportPreviewOpen}
        onClose={() => setReportPreviewOpen(false)}
        reportType="voucher-list"
        data={{ rows }}
        metadata={pdfMeta}
        shareText={shareText}
        title={`Voucher list · ${rows.length} line(s)`}
        showExcel
        excelDisabled={!hasRows}
        onExcel={() => downloadExcelRows(excelRows, 'VoucherList', `${compName || 'Company'}_VoucherList`)}
      />
    </div>
  );
}
