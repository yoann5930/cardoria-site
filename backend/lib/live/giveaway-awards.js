/** Stored inside the same Live action state as the draw, not in a second file. */
const clean=(value,max=160)=>String(value==null?"":value).trim().slice(0,max);

export function recordGiveawayAward(state) {
  if(!state||typeof state!=="object")return;
  if(!Array.isArray(state.giveawayAwards))state.giveawayAwards=[];
  const giveaway=state.giveaway;
  if(!giveaway?.id||!giveaway.winner||giveaway.status!=="ended"||giveaway.stockConsumed!==true)return;
  if(state.giveawayAwards.some(award=>award.giveawayId===giveaway.id))return;
  const weight=Number(giveaway.shippingWeightGrams);
  state.giveawayAwards.push({
    giveawayId:clean(giveaway.id,120),productId:clean(giveaway.productId,120),
    productName:clean(giveaway.productName,160),quantity:1,
    eligibility:clean(giveaway.eligibility||"public",40),
    // Missing legacy weights are explicit; never infer 20 g or use an edited lot.
    shippingWeightGrams:Number.isFinite(weight)&&weight>0?Math.ceil(weight):null,
    weightSource:Number.isFinite(weight)&&weight>0?"giveaway_snapshot":"unknown_legacy",
    winner:{id:clean(giveaway.winner.id,120),name:clean(giveaway.winner.name,120),email:clean(giveaway.winner.email,254).toLowerCase()},
    awardedAt:clean(giveaway.endedAt||giveaway.startedAt,40)
  });
}

export function giveawayAwardsFromState(state,{customerEmail=""}={}) {
  const copy=structuredClone(state||{});recordGiveawayAward(copy);
  const target=clean(customerEmail,254).toLowerCase();
  return copy.giveawayAwards.filter(award=>!target||award.winner?.email===target);
}
