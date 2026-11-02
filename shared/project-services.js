import { bad, text, optId, parseJSON } from './util.js';
export const SERVICE_TYPES = { social: 'Social media', website: 'Website', software: 'Software development', seo: 'SEO', ads: 'Ads' };
export function serviceFields(body) {
  const f = {};
  if (body.service_type !== undefined) {
    if (body.service_type !== '' && !SERVICE_TYPES[body.service_type]) throw bad('Choose a valid project field');
    f.service_type = body.service_type;
  }
  if (body.service_details !== undefined) {
    const b = body.service_details;
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Invalid project details');
    const d = {};
    for (const k of ['platforms','website_url','technology','objective','deliverables','application_type']) if (b[k] !== undefined) d[k] = text(b[k],{max:k === 'deliverables' ? 4000 : 500}) || '';
    for (const k of ['monthly_target','page_count','keyword_count','monthly_ad_budget']) if (b[k] !== undefined && b[k] !== '') { const n=Number(b[k]); if(!Number.isFinite(n) || n<0 || n>1000000000 || k !== 'monthly_ad_budget' && !Number.isInteger(n)) throw bad('Enter a valid ' + k.replaceAll('_',' ')); d[k]=n; }
    for (const k of ['lead_id','specialist_id','manager_id','head_id','sales_id']) if(b[k] !== undefined) d[k]=optId(b[k]);
    if (b.developer_ids !== undefined) {
      if (!Array.isArray(b.developer_ids)) throw bad('Choose developers from the team list');
      d.developer_ids=[...new Set(b.developer_ids.map(value=>{const id=optId(value);if(!id)throw bad('Choose a valid developer');return id;}))];
    }
    f.service_details = JSON.stringify(d);
  }
  return f;
}

// Used by the API and form; access is a Map on the server and an object in the client.
export function canChooseWorkContact(user, project) {
  if (!user || !project) return false;
  if (user.role === 'admin') return true;
  const level = user.access instanceof Map ? user.access.get(Number(project.vertical_id)) : user.access?.[project.vertical_id];
  if (level === 'manager') return true;
  if (level !== 'member') return false;
  const details = typeof project.service_details === 'string' ? parseJSON(project.service_details, {}) : project.service_details || {};
  return [details.manager_id, details.head_id].some(id => Number(id) === user.id);
}

export function isDevelopmentProject(project) { return ['website','software'].includes(project?.service_type); }

export const WEBSITE_STAGES = ['Design','Development','Testing','Launch'];
export function projectDetails(project) {
  return typeof project?.service_details === 'string' ? parseJSON(project.service_details,{}) || {} : project?.service_details || {};
}
export function websiteDevelopers(project) {
  const d=projectDetails(project);
  return [...new Set((Array.isArray(d.developer_ids)?d.developer_ids:d.specialist_id?[d.specialist_id]:[]).map(Number).filter(Boolean))];
}
export function projectRoleIds(details) {
  return [...new Set(Object.entries(details).flatMap(([key,value])=>key==='developer_ids'?value:key.endsWith('_id')&&value?[value]:[]).map(Number))];
}
export function normalizeWebsiteFields(fields, previous, defaultHead) {
  if (!isDevelopmentProject({service_type:fields.service_type ?? previous?.service_type})) return;
  const d=fields.service_details===undefined?projectDetails(previous):parseJSON(fields.service_details,{});
  const developers=websiteDevelopers({service_details:d});
  const head=d.head_id||d.manager_id||fields.owner_id||previous?.owner_id||defaultHead;
  const details={head_id:head,developer_ids:developers,sales_id:d.sales_id||null};
  for (const key of (fields.service_type ?? previous?.service_type) === 'software' ? ['application_type','technology'] : ['website_url','page_count','technology']) if(d[key]!==undefined)details[key]=d[key];
  fields.owner_id=head;
  fields.service_details=JSON.stringify(details);
}
