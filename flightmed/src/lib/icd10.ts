/**
 * A curated subset of ICD-10-CM codes common in medical evacuation / repatriation.
 * Free-text codes are also accepted at intake, so this list is a convenience, not a limit.
 */
export const ICD10: [string, string][] = [
  ["A41.9", "Sepsis, unspecified organism"],
  ["B34.9", "Viral infection, unspecified"],
  ["C34.90", "Malignant neoplasm of unspecified part of unspecified bronchus or lung"],
  ["E11.65", "Type 2 diabetes mellitus with hyperglycemia"],
  ["E87.1", "Hypo-osmolality and hyponatremia"],
  ["G40.909", "Epilepsy, unspecified, not intractable, without status epilepticus"],
  ["G45.9", "Transient cerebral ischemic attack, unspecified"],
  ["I10", "Essential (primary) hypertension"],
  ["I21.3", "ST elevation (STEMI) myocardial infarction of unspecified site"],
  ["I21.4", "Non-ST elevation (NSTEMI) myocardial infarction"],
  ["I26.99", "Other pulmonary embolism without acute cor pulmonale"],
  ["I46.9", "Cardiac arrest, cause unspecified"],
  ["I48.91", "Unspecified atrial fibrillation"],
  ["I50.9", "Heart failure, unspecified"],
  ["I61.9", "Nontraumatic intracerebral hemorrhage, unspecified"],
  ["I63.9", "Cerebral infarction, unspecified"],
  ["I71.00", "Dissection of unspecified site of aorta"],
  ["J18.9", "Pneumonia, unspecified organism"],
  ["J44.1", "Chronic obstructive pulmonary disease with (acute) exacerbation"],
  ["J80", "Acute respiratory distress syndrome"],
  ["J93.9", "Pneumothorax, unspecified"],
  ["J96.01", "Acute respiratory failure with hypoxia"],
  ["K35.80", "Unspecified acute appendicitis"],
  ["K56.609", "Unspecified intestinal obstruction, unspecified as to partial versus complete obstruction"],
  ["K85.90", "Acute pancreatitis without necrosis or infection, unspecified"],
  ["K92.2", "Gastrointestinal hemorrhage, unspecified"],
  ["N17.9", "Acute kidney failure, unspecified"],
  ["N39.0", "Urinary tract infection, site not specified"],
  ["O14.13", "Severe pre-eclampsia, third trimester"],
  ["O60.00", "Preterm labor without delivery, unspecified trimester"],
  ["P07.30", "Preterm newborn, unspecified weeks of gestation"],
  ["R40.20", "Unspecified coma"],
  ["R55", "Syncope and collapse"],
  ["R57.9", "Shock, unspecified"],
  ["S06.0X0A", "Concussion without loss of consciousness, initial encounter"],
  ["S06.5X0A", "Traumatic subdural hemorrhage without loss of consciousness, initial encounter"],
  ["S12.9XXA", "Fracture of neck, unspecified, initial encounter"],
  ["S22.9XXA", "Fracture of bony thorax, part unspecified, initial encounter"],
  ["S32.9XXA", "Fracture of unspecified parts of lumbosacral spine and pelvis, initial encounter"],
  ["S42.001A", "Fracture of unspecified part of right clavicle, initial encounter"],
  ["S72.001A", "Fracture of unspecified part of neck of right femur, initial encounter"],
  ["S72.002A", "Fracture of unspecified part of neck of left femur, initial encounter"],
  ["S82.201A", "Unspecified fracture of shaft of right tibia, initial encounter"],
  ["T07.XXXA", "Unspecified multiple injuries, initial encounter"],
  ["T30.0", "Burn of unspecified body region, unspecified degree"],
  ["T67.0XXA", "Heatstroke and sunstroke, initial encounter"],
  ["T70.3XXA", "Caisson disease [decompression sickness], initial encounter"],
  ["T75.1XXA", "Unspecified effects of drowning and nonfatal submersion, initial encounter"],
  ["U07.1", "COVID-19"],
];

export function searchIcd10(q: string, limit = 8): [string, string][] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return ICD10.filter(([c, d]) => c.toLowerCase().startsWith(s) || d.toLowerCase().includes(s)).slice(0, limit);
}
