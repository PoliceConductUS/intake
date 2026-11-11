import ExcelJS from 'exceljs';
import {writeFileSync} from 'node:fs';
const [,,src,dest]=process.argv;
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(src);
const ws=wb.getWorksheet('Departments');
const hdr=ws.getRow(1).values.map(v=>v==null?null:String(v));
const ix=n=>{const i=hdr.indexOf(n); if(i<0) throw new Error('missing column '+n); return i;};
// Only the three columns the classification needs. HEAD_NAME, E_MAIL, PHONE,
// FAX and the street address are deliberately not extracted: this file is
// committed to a public repository and the classification does not need them.
const C={num:ix('DEPARTMENT_NUMBER'),name:ix('DEPARTMENT_NAME'),type:ix('DEPARTMENT_TYPE'),status:ix('STATUS'),state:ix('STATE')};
const out=[];
ws.eachRow((row,i)=>{ if(i===1)return; const v=row.values;
  out.push({n:String(v[C.name]??'').trim(),t:String(v[C.type]??'').trim(),s:String(v[C.state]??'').trim(),a:String(v[C.status]??'').trim()});
});
out.sort((x,y)=>x.n.localeCompare(y.n));
writeFileSync(dest, JSON.stringify({
  source:"Texas Commission on Law Enforcement — Departments roster",
  recordsRequestId:"PublicInformationRequest_2025-02-10_1410.xlsx",
  retrievedOn:"2025-02-10",
  sourceField:"DEPARTMENT_TYPE",
  note:"Columns extracted verbatim: DEPARTMENT_NAME (n), DEPARTMENT_TYPE (t), STATE (s), STATUS (a). The roster's HEAD_NAME, E_MAIL, PHONE, FAX and street-address columns are deliberately omitted — the classification does not need them and this file is committed to a public repository.",
  rowCount: out.length,
  departments: out,
}, null, 0) + "\n");
console.log('wrote', out.length, 'rows to', dest);
