// Normalization is deliberately narrow: this is a duplicate-title guard,
// NOT fuzzy entity matching or a substitute for evidence-based project linking.
export function isDuplicateActiveTask(title:string,existingTitles:readonly string[]):boolean{
  const normalize=(s:string)=>s.normalize('NFKC')
    .replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
  const needle=normalize(title);
  if(needle.length<5)return false;
  return existingTitles.some(raw=>{
    const hay=normalize(raw);
    return needle===hay||(needle.length>=8&&hay.includes(needle));
  });
}
