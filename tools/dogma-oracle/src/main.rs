//! Dogma oracle harness.
//!
//! Runs EVEShipFit's `dogma-engine` (vendored under `third_party/dogma-engine`,
//! MIT, see its LICENSE) over a fit corpus, using EveJS's own SDE as the static
//! data source so both engines see identical inputs.
//!
//! Usage:
//!   dogma-oracle <datapack.json> <corpus.json> <out.json>
//!
//! This binary is READ-ONLY: it touches no EveJS runtime state and changes no
//! game mechanics. It exists purely to produce reference numbers.

use std::collections::BTreeMap;
use std::collections::HashMap;

use esf_dogma_engine::calculate;
use esf_dogma_engine::data_types as dt;
use esf_dogma_engine::info::Info;

use serde::Deserialize;
use serde::Serialize;

// ---------------------------------------------------------------------------
// Data pack (produced by build-datapack.mjs from EveJS's SDE JSONL)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PackType {
    groupID: i32,
    categoryID: i32,
    mass: Option<f64>,
    capacity: Option<f64>,
    volume: Option<f64>,
    radius: Option<f64>,
    name: String,
}

#[derive(Deserialize)]
struct PackTypeDogma {
    a: Vec<(i32, f64)>,
    e: Vec<(i32, i32)>,
}

#[derive(Deserialize, Clone)]
struct PackAttribute {
    defaultValue: f64,
    highIsGood: bool,
    stackable: bool,
    name: String,
    #[allow(dead_code)]
    unitID: Option<i32>,
}

#[derive(Deserialize)]
struct PackModifier {
    domain: i32,
    func: i32,
    modifiedAttributeID: Option<i32>,
    modifyingAttributeID: Option<i32>,
    operation: i32,
    groupID: Option<i32>,
    skillTypeID: Option<i32>,
}

#[derive(Deserialize)]
struct PackEffect {
    #[allow(dead_code)]
    name: String,
    dischargeAttributeID: Option<i32>,
    durationAttributeID: Option<i32>,
    effectCategory: i32,
    electronicChance: bool,
    isAssistance: bool,
    isOffensive: bool,
    isWarpSafe: bool,
    propulsionChance: bool,
    rangeChance: bool,
    rangeAttributeID: Option<i32>,
    falloffAttributeID: Option<i32>,
    trackingSpeedAttributeID: Option<i32>,
    fittingUsageChanceAttributeID: Option<i32>,
    resistanceAttributeID: Option<i32>,
    modifierInfo: Vec<PackModifier>,
}

#[derive(Deserialize)]
struct Pack {
    sde: String,
    types: HashMap<String, PackType>,
    typeDogma: HashMap<String, PackTypeDogma>,
    dogmaAttributes: HashMap<String, PackAttribute>,
    dogmaEffects: HashMap<String, PackEffect>,
}

struct Data {
    types: HashMap<i32, PackType>,
    type_dogma: HashMap<i32, PackTypeDogma>,
    attributes: HashMap<i32, PackAttribute>,
    effects: HashMap<i32, PackEffect>,
    attr_by_name: HashMap<String, i32>,
}

impl Data {
    fn from_pack(p: Pack) -> Data {
        fn key<V>(m: HashMap<String, V>) -> HashMap<i32, V> {
            m.into_iter()
                .map(|(k, v)| (k.parse::<i32>().unwrap(), v))
                .collect()
        }
        let attributes: HashMap<i32, PackAttribute> = key(p.dogmaAttributes);
        let attr_by_name = attributes
            .iter()
            .map(|(id, a)| (a.name.clone(), *id))
            .collect();
        eprintln!("[oracle] sde = {}", p.sde);
        Data {
            types: key(p.types),
            type_dogma: key(p.typeDogma),
            attributes,
            effects: key(p.dogmaEffects),
            attr_by_name,
        }
    }
}

// ---------------------------------------------------------------------------
// Fit corpus
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CorpusModule {
    typeID: i32,
    slot: String,
    index: i32,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    charge: Option<i32>,
}

#[derive(Deserialize)]
struct CorpusDrone {
    typeID: i32,
    #[serde(default)]
    count: Option<i32>,
}

#[derive(Deserialize)]
struct CorpusFit {
    id: String,
    name: String,
    shipTypeID: i32,
    #[serde(default)]
    modules: Vec<CorpusModule>,
    #[serde(default)]
    drones: Vec<CorpusDrone>,
}

#[derive(Deserialize)]
struct Corpus {
    /// "none" = untrained pilot, "all5" = every skill at V.
    skills: String,
    fits: Vec<CorpusFit>,
}

// ---------------------------------------------------------------------------
// Info implementation backed by EveJS's SDE
// ---------------------------------------------------------------------------

struct OracleInfo<'a> {
    data: &'a Data,
    fit: dt::EsfFit,
    skills: BTreeMap<i32, i32>,
}

impl Info for OracleInfo<'_> {
    fn skills(&self) -> &BTreeMap<i32, i32> {
        &self.skills
    }

    fn fit(&self) -> &dt::EsfFit {
        &self.fit
    }

    fn get_dogma_attributes(&self, type_id: i32) -> Vec<dt::TypeDogmaAttribute> {
        match self.data.type_dogma.get(&type_id) {
            None => vec![],
            Some(td) => td
                .a
                .iter()
                .map(|(id, v)| dt::TypeDogmaAttribute {
                    attributeID: *id,
                    value: *v,
                })
                .collect(),
        }
    }

    fn get_dogma_attribute(&self, attribute_id: i32) -> dt::DogmaAttribute {
        match self.data.attributes.get(&attribute_id) {
            None => dt::DogmaAttribute {
                defaultValue: 0.0,
                highIsGood: false,
                stackable: false,
            },
            Some(a) => dt::DogmaAttribute {
                defaultValue: a.defaultValue,
                highIsGood: a.highIsGood,
                stackable: a.stackable,
            },
        }
    }

    fn get_dogma_effects(&self, type_id: i32) -> Vec<dt::TypeDogmaEffect> {
        match self.data.type_dogma.get(&type_id) {
            None => vec![],
            Some(td) => td
                .e
                .iter()
                .map(|(id, d)| dt::TypeDogmaEffect {
                    effectID: *id,
                    isDefault: *d != 0,
                })
                .collect(),
        }
    }

    fn get_dogma_effect(&self, effect_id: i32) -> dt::DogmaEffect {
        match self.data.effects.get(&effect_id) {
            None => dt::DogmaEffect {
                dischargeAttributeID: None,
                durationAttributeID: None,
                effectCategory: 0,
                electronicChance: false,
                isAssistance: false,
                isOffensive: false,
                isWarpSafe: false,
                propulsionChance: false,
                rangeChance: false,
                rangeAttributeID: None,
                falloffAttributeID: None,
                trackingSpeedAttributeID: None,
                fittingUsageChanceAttributeID: None,
                resistanceAttributeID: None,
                modifierInfo: vec![],
            },
            Some(e) => dt::DogmaEffect {
                dischargeAttributeID: e.dischargeAttributeID,
                durationAttributeID: e.durationAttributeID,
                effectCategory: e.effectCategory,
                electronicChance: e.electronicChance,
                isAssistance: e.isAssistance,
                isOffensive: e.isOffensive,
                isWarpSafe: e.isWarpSafe,
                propulsionChance: e.propulsionChance,
                rangeChance: e.rangeChance,
                rangeAttributeID: e.rangeAttributeID,
                falloffAttributeID: e.falloffAttributeID,
                trackingSpeedAttributeID: e.trackingSpeedAttributeID,
                fittingUsageChanceAttributeID: e.fittingUsageChanceAttributeID,
                resistanceAttributeID: e.resistanceAttributeID,
                modifierInfo: e
                    .modifierInfo
                    .iter()
                    .map(|m| dt::DogmaEffectModifierInfo {
                        domain: m.domain.into(),
                        func: m.func.into(),
                        modifiedAttributeID: m.modifiedAttributeID,
                        modifyingAttributeID: m.modifyingAttributeID,
                        operation: Some(m.operation),
                        groupID: m.groupID,
                        skillTypeID: m.skillTypeID,
                    })
                    .collect(),
            },
        }
    }

    fn get_type(&self, type_id: i32) -> dt::Type {
        match self.data.types.get(&type_id) {
            None => dt::Type {
                groupID: 0,
                categoryID: 0,
                capacity: None,
                mass: None,
                radius: None,
                volume: None,
            },
            Some(t) => dt::Type {
                groupID: t.groupID,
                categoryID: t.categoryID,
                capacity: t.capacity,
                mass: t.mass,
                radius: t.radius,
                volume: t.volume,
            },
        }
    }

    fn attribute_name_to_id(&self, name: &str) -> i32 {
        *self.data.attr_by_name.get(name).unwrap_or(&0)
    }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct OutAttr {
    id: i32,
    name: String,
    base: f64,
    value: f64,
}

#[derive(Serialize)]
struct OutItem {
    type_id: i32,
    name: String,
    slot: String,
    index: Option<i32>,
    state: String,
    attributes: Vec<OutAttr>,
    charge_type_id: Option<i32>,
    charge_name: Option<String>,
    charge_attributes: Option<Vec<OutAttr>>,
}

#[derive(Serialize)]
struct OutFit {
    id: String,
    name: String,
    ship_type_id: i32,
    ship_name: String,
    hull: Vec<OutAttr>,
    items: Vec<OutItem>,
}

fn dump_attrs(data: &Data, item: &calculate::item::Item) -> Vec<OutAttr> {
    let mut out: Vec<OutAttr> = item
        .attributes
        .iter()
        .map(|(id, a)| OutAttr {
            id: *id,
            name: data
                .attributes
                .get(id)
                .map(|x| x.name.clone())
                .unwrap_or_default(),
            base: a.base_value,
            value: a.value.unwrap_or(a.base_value),
        })
        .collect();
    out.sort_by_key(|a| a.id);
    out
}

fn slot_type(s: &str) -> dt::EsfSlotType {
    match s.to_ascii_lowercase().as_str() {
        "high" => dt::EsfSlotType::High,
        "medium" | "mid" => dt::EsfSlotType::Medium,
        "low" => dt::EsfSlotType::Low,
        "rig" => dt::EsfSlotType::Rig,
        "subsystem" => dt::EsfSlotType::SubSystem,
        "service" => dt::EsfSlotType::Service,
        other => panic!("unknown slot type {}", other),
    }
}

fn state(s: Option<&str>) -> dt::EsfState {
    match s.unwrap_or("Active").to_ascii_lowercase().as_str() {
        "passive" => dt::EsfState::Passive,
        "online" => dt::EsfState::Online,
        "active" => dt::EsfState::Active,
        "overload" => dt::EsfState::Overload,
        other => panic!("unknown state {}", other),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: dogma-oracle <datapack.json> <corpus.json> <out.json>");
        std::process::exit(2);
    }

    let pack: Pack =
        serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(&args[1]).unwrap()))
            .expect("failed to read datapack");
    let data = Data::from_pack(pack);

    let corpus: Corpus =
        serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(&args[2]).unwrap()))
            .expect("failed to read corpus");

    // Skill set. Category 16 == Skill.
    let skills: BTreeMap<i32, i32> = if let Some(file) = corpus.skills.strip_prefix('@') {
        // Explicit {typeID: level} map, resolved relative to the corpus file.
        let dir = std::path::Path::new(&args[2])
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let raw: HashMap<String, i32> = serde_json::from_reader(std::io::BufReader::new(
            std::fs::File::open(dir.join(file)).expect("failed to open skills file"),
        ))
        .expect("failed to read skills file");
        raw.into_iter()
            .map(|(k, v)| (k.parse::<i32>().unwrap(), v))
            .collect()
    } else {
        match corpus.skills.as_str() {
            "none" => BTreeMap::new(),
            "all5" => data
                .types
                .iter()
                .filter(|(_, t)| t.categoryID == 16)
                .map(|(id, _)| (*id, 5))
                .collect(),
            other => panic!("unknown skills mode {}", other),
        }
    };
    eprintln!("[oracle] skills mode = {} ({})", corpus.skills, skills.len());

    let mut out_fits = Vec::new();

    for fit in &corpus.fits {
        let mut modules = Vec::new();
        for m in &fit.modules {
            modules.push(dt::EsfModule {
                type_id: m.typeID,
                slot: dt::EsfSlot {
                    r#type: slot_type(&m.slot),
                    index: m.index,
                },
                state: state(m.state.as_deref()),
                charge: m.charge.map(|c| dt::EsfCharge { type_id: c }),
            });
        }
        let mut drones = Vec::new();
        for d in &fit.drones {
            for _ in 0..d.count.unwrap_or(1) {
                drones.push(dt::EsfDrone {
                    type_id: d.typeID,
                    state: dt::EsfState::Active,
                });
            }
        }

        let info = OracleInfo {
            data: &data,
            fit: dt::EsfFit {
                ship_type_id: fit.shipTypeID,
                modules,
                drones,
            },
            skills: skills.clone(),
        };

        let ship = calculate::calculate(&info);

        let items = ship
            .items
            .iter()
            .map(|item| OutItem {
                type_id: item.type_id,
                name: data
                    .types
                    .get(&item.type_id)
                    .map(|t| t.name.clone())
                    .unwrap_or_default(),
                slot: format!("{:?}", item.slot.r#type),
                index: item.slot.index,
                state: format!("{:?}", item.state),
                attributes: dump_attrs(&data, item),
                charge_type_id: item.charge.as_ref().map(|c| c.type_id),
                charge_name: item.charge.as_ref().map(|c| {
                    data.types
                        .get(&c.type_id)
                        .map(|t| t.name.clone())
                        .unwrap_or_default()
                }),
                charge_attributes: item.charge.as_ref().map(|c| dump_attrs(&data, c)),
            })
            .collect();

        out_fits.push(OutFit {
            id: fit.id.clone(),
            name: fit.name.clone(),
            ship_type_id: fit.shipTypeID,
            ship_name: data
                .types
                .get(&fit.shipTypeID)
                .map(|t| t.name.clone())
                .unwrap_or_default(),
            hull: dump_attrs(&data, &ship.hull),
            items,
        });

        eprintln!("[oracle] calculated {}", fit.id);
    }

    let f = std::fs::File::create(&args[3]).unwrap();
    serde_json::to_writer_pretty(std::io::BufWriter::new(f), &out_fits).unwrap();
    eprintln!("[oracle] wrote {}", args[3]);
}
