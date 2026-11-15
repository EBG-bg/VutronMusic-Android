const test = require('node:test'), assert = require('node:assert/strict');
const { filterCommentScope } = require('../src/main/assets/sources-runtime/netease-comment-scope.cjs');
test('foreign promoted comment is removed without editing matching or legacy comments and pagination', () => {
  const foreign = { commentId: 9691851703, threadId: 'R_SO_4_1391891631', content: 'activity' };
  const matching = { commentId: 1129476750, threadId: 'R_SO_4_553135737', content: 'activity' };
  const legacy = { commentId: 3, content: 'activity' };
  const body = { code: 200, data: { comments: [foreign, matching, legacy], cursor: 'next', hasMore: true, totalCount: 1598 } };
  const result = filterCommentScope('comment_new', { type: 0, id: '553135737' }, body);
  assert.deepEqual(result.data.comments, [matching, legacy]);
  assert.equal(result.data.cursor, 'next'); assert.equal(result.data.hasMore, true); assert.equal(body.data.comments.length, 3);
  assert.deepEqual(filterCommentScope('comment_floor', { type: 0, id: '553135737' }, body).data.comments, [matching, legacy]);
  assert.equal(filterCommentScope('song_detail', { type: 0, id: '553135737' }, body), body);
  assert.equal(filterCommentScope('comment_new', { type: 20, id: '553135737' }, body), body);
});

test('resource scoping supports all original comment types and preserves content even when it looks promotional',()=>{
  for(const [type,prefix] of [[0,'R_SO_4_'],[1,'R_MV_5_'],[2,'A_PL_0_'],[3,'R_AL_3_']]){
    const row={commentId:1,threadId:prefix+'123',content:'活动：参与抽奖',user:{nickname:'普通听众'}};
    const body={code:200,data:{comments:[row,{...row,commentId:2,threadId:prefix+'456'}],hasMore:true,cursor:'opaque#42',totalCount:7}};
    const result=filterCommentScope('comment_new',{type:String(type),id:'123'},body);
    assert.deepEqual(result.data.comments,[row]);assert.equal(result.data.totalCount,7);assert.equal(result.data.cursor,'opaque#42');
  }
});
