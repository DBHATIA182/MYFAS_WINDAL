import React, { useState, useEffect } from 'react';

const SelectionBar = ({ company, setCompany, setYear, setCompUid, setStartDate, setEndDate, setCompName }) => {
  const [companies, setCompanies] = useState([]);
  const [years, setYears] = useState([]);
  const [localYear, setLocalYear] = useState('');

  // 1. Fetch Company List
  useEffect(() => {
    fetch('https://rbrl-api.fasaccountingsoftware.in/api/companies')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCompanies(data);
      })
      .catch(err => console.error("Company Load Error:", err));
  }, []);

  // 2. Fetch Year Details when company changes
  useEffect(() => {
    if (company) {
      fetch(`https://rbrl-api.fasaccountingsoftware.in/api/years?comp_code=${company}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setYears(data);
            setLocalYear('');
          }
        })
        .catch(err => console.error("Year Load Error:", err));
    }
  }, [company]);

  // 3. When company dropdown changes, also store comp_name
  const handleCompanyChange = (e) => {
    const selectedCode = e.target.value;
    setCompany(selectedCode);
    const compData = companies.find(c => c.COMP_CODE === selectedCode);
    if (compData && setCompName) setCompName(compData.COMP_NAME);
  };

  // 4. Update all App states when Year is picked
  const handleYearChange = (e) => {
    const selectedVal = e.target.value;
    setLocalYear(selectedVal);
    const yearData = years.find(y => y.COMP_YEAR === selectedVal);
    if (yearData) {
      setYear(selectedVal);
      setCompUid(yearData.COMP_UID);
      setStartDate(yearData.COMP_S_DT);   // ✅ Start date for Ledger
      setEndDate(yearData.COMP_E_DT);
    }
  };

  return (
    <div style={barStyle}>
      <div style={itemStyle}>
        <label>Company: </label>
        <select value={company} onChange={handleCompanyChange} style={selectStyle}>
          <option value="">-- Select --</option>
          {companies.map(co => (
            <option key={co.COMP_CODE} value={co.COMP_CODE}>{co.COMP_NAME}</option>
          ))}
        </select>
      </div>

      <div style={itemStyle}>
        <label>Year: </label>
        <select
          value={localYear}
          onChange={handleYearChange}
          style={selectStyle}
          disabled={!company}
        >
          <option value="">-- Select --</option>
          {years.map(y => (
            <option key={y.COMP_YEAR} value={y.COMP_YEAR}>{y.COMP_YEAR}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

const barStyle = { display: 'flex', gap: '20px', padding: '10px', background: '#e0e0e0', borderBottom: '1px solid #bbb' };
const itemStyle = { display: 'flex', alignItems: 'center', gap: '5px' };
const selectStyle = { padding: '4px', borderRadius: '4px' };

export default SelectionBar;
