// NetEase may recommend a global activity's comment inside an unrelated song.
// Keep only this resource's comments; never classify user text by keywords.
function filterCommentScope(method, params, body) {
  if (!['comment_new', 'comment_floor'].includes(method) || !Array.isArray(body?.data?.comments)) return body;
  const prefixes = { 0: 'R_SO_4_', 1: 'R_MV_5_', 2: 'A_PL_0_', 3: 'R_AL_3_' };
  const prefix = prefixes[params.type];
  if (!prefix || !/^[1-9][0-9]*$/.test(String(params.id))) return body;
  const expected = prefix + params.id;
  return { ...body, data: { ...body.data, comments: body.data.comments.filter(row => !row?.threadId || row.threadId === expected) } };
}
module.exports = { filterCommentScope };
