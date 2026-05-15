import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function normChType(raw) {
  const c = String(raw ?? 'I')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  return c || 'I';
}

function groupDispatchPrintRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const ct = normChType(r.CH_TYPE ?? r.ch_type);
    const rn = r.R_NO ?? r.r_no;
    const key = `${ct}|${rn}`;
    if (!map.has(key)) {
      const rd = r.R_DATE ?? r.r_date;
      map.set(key, {
        ch_type: ct,
        r_no: rn,
        r_date_display: toDisplayDate(toInputDateString(rd)),
        party: {
          name: r.NAME ?? r.name,
          add1: r.ADD1 ?? r.add1,
          add2: r.ADD2 ?? r.add2,
          city: r.CITY ?? r.city,
          gst: r.GST_NO ?? r.gst_no,
          pan: r.PAN ?? r.pan,
          tel: r.TEL_NO_O ?? r.tel_no_o,
        },
        footer: {
          remarks: r.REMARKS ?? r.remarks,
          truck_no: r.TRUCK_NO ?? r.truck_no,
          tpt: r.TPT ?? r.tpt,
          gr_no: r.GR_NO ?? r.gr_no,
        },
        lines: [],
      });
    }
    map.get(key).lines.push(r);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.ch_type !== b.ch_type) return a.ch_type.localeCompare(b.ch_type);
    return (Number(a.r_no) || 0) - (Number(b.r_no) || 0);
  });
}

export default function DispatchChallanPrintScreen({
  apiBase,
  formData,
  defaultChType = 'I',
  defaultRNo = '',
  defaultRDateYmd = '',
  onClose,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sDate, setSDate] = useState(() => defaultRDateYmd || fyStart);
  const [eDate, setEDate] = useState(() => defaultRDateYmd || fyEnd);
  const [sNo, setSNo] = useState(() => String(defaultRNo ?? '').trim());
  const [eNo, setENo] = useState(() => String(defaultRNo ?? '').trim());
  const [chType, setChType] = useState(() => normChType(defaultChType));

  const [compdet, setCompdet] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);

  const challans = useMemo(() => groupDispatchPrintRows(rawRows), [rawRows]);

  const pdfData = useMemo(
    () => ({
      compdet: compdet || {},
      challans,
    }),
    [compdet, challans]
  );

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      apiBase,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      chTypeLabel: chType,
      sNo,
      eNo,
    }),
    [compName, apiBase, sDate, eDate, chType, sNo, eNo]
  );

  const previewDocHtml = useMemo(() => {
    if (!ran || !challans.length) return '';
    const body = buildReportHtml('dispatch-challan-print', pdfData, pdfMeta);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 12px; background: #cbd5e1; }
      .dc-pdf-page { box-shadow: 0 4px 16px rgba(15, 23, 42, 0.14); }
      @media print {
        html, body { padding: 0; background: #fff; }
        .dc-pdf-page { box-shadow: none !important; margin-bottom: 0 !important; }
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
  }, [ran, challans.length, pdfData, pdfMeta]);

  const excelRows = useMemo(
    () =>
      rawRows.map((r) => ({
        ChType: r.CH_TYPE ?? r.ch_type,
        ChNo: r.R_NO ?? r.r_no,
        ChDate: toDisplayDate(toInputDateString(r.R_DATE ?? r.r_date)),
        Party: r.NAME ?? r.name,
        Trn: r.TRN_NO ?? r.trn_no,
        Item: r.ITEM_CODE ?? r.item_code,
        ItemName: r.ITEM_NAME ?? r.item_name,
        Marka: r.MARKA ?? r.marka,
        HSN: r.HSN_CODE ?? r.hsn_code,
        Unit: r.STATUS ?? r.status,
        Qty: r.QNTY ?? r.qnty,
        Weight: r.WEIGHT ?? r.weight,
        Rate: r.RATE ?? r.rate,
        Amount: r.AMOUNT ?? r.amount,
        Remarks: r.REMARKS ?? r.remarks,
        TruckNo: r.TRUCK_NO ?? r.truck_no,
        Tpt: r.TPT ?? r.tpt,
        GRNo: r.GR_NO ?? r.gr_no,
      })),
    [rawRows]
  );

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${apiBase}/api/compdet-print-header`, {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      })
      .then((res) => {
        if (!cancelled) setCompdet(res.data || null);
      })
      .catch(() => {
        if (!cancelled) setCompdet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid]);

  const runReport = useCallback(async () => {
    setErr('');
    if (!sDate || !eDate) {
      setErr('Starting date and ending date are required.');
      return;
    }
    const sn = Math.max(0, Math.floor(Number(sNo) || 0));
    const en = Math.max(sn, Math.floor(Number(eNo) || 0));
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan-print`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDate),
          e_date: toOracleDate(eDate),
          s_no: sn,
          e_no: en,
          ch_type: normChType(chType),
        },
        ...reqOpts,
      });
      setRawRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Print load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, sDate, eDate, sNo, eNo, chType]);

  const backToRange = () => {
    setRan(false);
    setRawRows([]);
    setErr('');
  };

  const shareText = [
    compName,
    'Dispatch challan',
    `${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}`,
    `Type ${normChType(chType)} · Ch ${sNo || '0'}–${eNo || '0'}`,
  ].join('\n');

  const handleBrowserPrint = () => {
    if (!previewDocHtml) {
      alert('Run report first — no challans to print.');
      return;
    }
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      alert('Allow pop-ups to print.');
      return;
    }
    w.document.write(previewDocHtml);
    w.document.close();
    w.onload = () => w.print();
  };

  const hasChallans = challans.length > 0;
  const printActionButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        ← Back
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewDocHtml} onClick={handleBrowserPrint}>
        Print
      </button>
      <button
        type="button"
        className="btn btn-export"
        disabled={!hasChallans}
        onClick={() =>
          generatePDF('dispatch-challan-print', pdfData, pdfMeta).catch((e) => alert(e?.message || String(e)))
        }
      >
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!rawRows.length}
        onClick={() => downloadExcelRows(excelRows, 'DispatchChallanPrint', `${compName}_DispatchChallan_Print`)}
      >
        Excel
      </button>
      <button
        type="button"
        className="btn btn-whatsapp"
        disabled={!hasChallans}
        title={hasChallans ? 'Share print PDF on WhatsApp' : 'Show challans first'}
        onClick={() =>
          sharePdfWithWhatsApp('dispatch-challan-print', pdfData, pdfMeta, shareText).catch((e) =>
            alert(e?.message || String(e))
          )
        }
      >
        WhatsApp
      </button>
    </>
  );

  return (
    <div className="slide slide-22-dispatch-challan-print dc-print-screen">
      <header className="dc-print-screen__head">
        <h2 className="sale-bill-page__title">Dispatch challan print</h2>
      </header>

      <DcActionBar position="top" label="Print actions">
        {printActionButtons}
      </DcActionBar>

      <section className="sale-bill-section sale-bill-section--card dc-print-filters">
        <h3 className="sale-bill-section__title">Print range</h3>
        <div className="dc-print-filters-grid">
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Starting date</span>
            <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending date</span>
            <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Starting ch.no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={sNo}
              onChange={(e) => setSNo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending ch.no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={eNo}
              onChange={(e) => setENo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ch.type</span>
            <input
              className="form-input dc-print-ch-type"
              maxLength={1}
              value={chType}
              onChange={(e) => setChType(normChType(e.target.value))}
            />
          </label>
        </div>
        <div className="dc-print-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
            {loading ? 'Loading…' : 'Show challans'}
          </button>
          {ran ? (
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={backToRange}>
              Change range
            </button>
          ) : null}
        </div>
      </section>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      {!ran && !loading ? (
        <p className="sale-bill-section__hint dc-print-run-hint">
          Enter date and challan number range, then click Show challans. Each challan prints on its own page with full
          header and footer.
        </p>
      ) : null}

      {ran ? (
        <section className="sale-bill-section sale-bill-section--card dc-print-results">
          <div className="dc-print-results__toolbar">
            <p className="sale-bill-totals-summary">
              {challans.length} challan(s) · {rawRows.length} line(s)
            </p>
          </div>
          {challans.length ? (
            <iframe title="Dispatch challan print preview" className="dc-print-preview-frame" srcDoc={previewDocHtml} />
          ) : (
            <p className="sale-bill-section__hint">No challans in the selected range.</p>
          )}
        </section>
      ) : null}

      <DcActionBar position="bottom" label="Print actions">
        {printActionButtons}
      </DcActionBar>
    </div>
  );
}
