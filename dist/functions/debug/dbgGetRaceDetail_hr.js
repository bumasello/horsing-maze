"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teste = exports.dbgGetRaceDetailAndStore_Hr = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const raceDetailHrModel_1 = __importDefault(require("../../models/modelHr/raceDetailHrModel"));
const __1 = require("../../");
dotenv_1.default.config();
const getAllStoredRaceDetail_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find().lean();
    return racedetail;
});
const getStoredRaceDetail_Hr = (id_race) => __awaiter(void 0, void 0, void 0, function* () {
    const racedetail = yield raceDetailHrModel_1.default.find({
        id_race: id_race,
    });
    return racedetail;
});
const dbgGetRaceDetailAndStore_Hr = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const data = exports.teste;
        const horses = Array.isArray(data.horses) ? data.horses : [];
        const _a = data, { _id: detailId } = _a, dataSansId = __rest(_a, ["_id"]);
        const { horses: horsesArray, _id: cardId } = dataSansId, raceCardFields = __rest(dataSansId, ["horses", "_id"]);
        if (horses.length > 8 && horses.length <= 15) {
            // 1) Atualiza RaceCard (só campos que interessam + checked_detail)
            console.log("checked_detail: true");
            // 2) Processamento dos cavalos antes de salvá-los
            const processedHorses = [];
            const incomingHorseIds = [];
            for (const hr of horses) {
                // Verifica se id_horse é um número válido, caso contrário marca como non-runner
                if (hr.non_runner === "1") {
                    hr.position = "0";
                    hr.distance_beaten = "0";
                }
                if (Number.isNaN(Number(hr.position))) {
                    console.log("coloquei o position zero e o non-runner 1");
                    hr.position = "0"; // Define como 0 se não for um número válido
                    hr.non_runner = "1"; // Marca como non-runner
                    hr.distance_beaten = "0";
                }
                incomingHorseIds.push(hr.id_horse);
                // remove o _id do hr antes de atualizar
                const _b = hr, { _id: hid } = _b, horseSansId = __rest(_b, ["_id"]);
                // Salva o cavalo no banco de dados
                // const savedHorse = await Horse.HorseModel_Hr.findOneAndUpdate(
                //   { id_horse: hr.id_horse, id_race: hr.id_race },
                //   horseSansId,
                //   { upsert: true, new: true, setDefaultsOnInsert: true },
                // );
                //
                hr.distance_beaten = hr.distance_beaten || "0";
                hr.position = hr.position || "0";
                const savedHorse = hr;
                console.log("salva o cavalo no horse model");
                // Adiciona o cavalo processado ao array
                processedHorses.push(savedHorse);
            }
            // 3) Agora fazemos o upsert do RaceCardDetail com os cavalos já processados
            const updatedData = Object.assign(Object.assign({}, raceCardFields), { horses: processedHorses, id_race: data.id_race });
            // await RaceCardDetail.findOneAndUpdate(
            //   { id_race: data.id_race },
            //   updatedData,
            //   { upsert: true, new: true, setDefaultsOnInsert: true },
            // );
            // 4) Limpa horses removidos do feed
            // await Horse.HorseModel_Hr.deleteMany({
            //   id_race: raceid,
            //   id_horse: { $nin: incomingHorseIds },
            // });
            console.log(updatedData);
            yield __1.supabase.from("race_horses_hr").insert(updatedData);
        }
        else {
            // se inválido, remove tudo
            // await RaceCardDetail.deleteOne({ id_race: raceid });
            // await Horse.HorseModel_Hr.deleteMany({ id_race: raceid });
            // await RaceCard.deleteOne({ id_race: raceid });
            console.log("deletado: ", exports.teste.id_race);
        }
    }
    catch (error) {
        throw new Error(`Erro em getRaceDetailAndStore_Hr: ${error}`);
    }
});
exports.dbgGetRaceDetailAndStore_Hr = dbgGetRaceDetailAndStore_Hr;
exports.default = {
    getStoredRaceDetail_Hr,
    getAllStoredRaceDetail_Hr,
};
exports.teste = {
    id_race: 207660,
    course: "Newcastle",
    date: "2021-09-02 20:35:00",
    title: "WILLIAM HILL DOUBLE YOUR ODDS RACING LEAGUE RACE THIRTY-SIX (HANDICAP) (3)",
    distance: "5f",
    age: "3",
    going: "Standard to Slow",
    finished: "0",
    canceled: "0",
    finish_time: "",
    prize: "£25770",
    horses: [
        {
            horse: "Kingsholm(IRE)",
            id_horse: "237421",
            jockey: "Jack Mitchell",
            trainer: "James Fanshawe",
            age: "4",
            weight: "8-10",
            number: "9",
            last_ran_days_ago: "35",
            non_runner: "0",
            form: "51201-446",
            position: "pu",
            distance_beaten: "",
            owner: "Qatar Racing, D.Howden &amp;amp; D.Redvers",
            sire: "TAGULA(IRE)",
            dam: "FIXED GAZE(USA)",
            OR: "73",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "6",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462519&amp;affiliatecode=365_00918918&amp;odds=5/1&amp;Instantbet=1&amp;AVG=BB87BFC4E174285D3ACE0823A981E544BCA0B5F4",
                },
                {
                    bookie: "Betway",
                    odd: "5.5",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "5.5",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "6.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "5.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864863.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575174&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Faustus",
            id_horse: "247521",
            jockey: "Robert Havlin",
            trainer: "Robert Cowell",
            age: "3",
            weight: "9-4",
            number: "5",
            last_ran_days_ago: "35",
            non_runner: "0",
            form: "25-482312",
            position: "",
            distance_beaten: "",
            owner: "Mrs Jenny Hadida",
            sire: "MAYSON",
            dam: "ISRAFEL",
            OR: "82",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "6.5",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462516&amp;affiliatecode=365_00918918&amp;odds=11/2&amp;Instantbet=1&amp;AVG=189E8FF027E84114A794CAD653E7AE8C57125B68",
                },
                {
                    bookie: "Betway",
                    odd: "6.5",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "7",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "6.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "6",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864859.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "6.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575158&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Electric Love",
            id_horse: "252385",
            jockey: "Laura Pearson",
            trainer: "Tom Clover",
            age: "3",
            weight: "8-9",
            number: "10",
            last_ran_days_ago: "7",
            non_runner: "0",
            form: "2241123",
            position: "",
            distance_beaten: "",
            owner: null,
            sire: null,
            dam: null,
            OR: "73",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "7",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462515&amp;affiliatecode=365_00918918&amp;odds=6/1&amp;Instantbet=1&amp;AVG=966585F171FC644700A27DCB9DE2BD7150B951FD",
                },
                {
                    bookie: "Betway",
                    odd: "7",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "7",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "6.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "7",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864864.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "7",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575130&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Kool Moe Dee(IRE)",
            id_horse: "244169",
            jockey: "Hayley Turner",
            trainer: "Richard Hannon",
            age: "3",
            weight: "8-9",
            number: "11",
            last_ran_days_ago: "7",
            non_runner: "0",
            form: "54467267",
            position: "",
            distance_beaten: "",
            owner: "Mr K. Sohi",
            sire: "MEHMAS(IRE)",
            dam: "SENADORA(GER)",
            OR: "73",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "7",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462520&amp;affiliatecode=365_00918918&amp;odds=6/1&amp;Instantbet=1&amp;AVG=5247A147F3ABD31D482922794F5E0AD4BE3C02FA",
                },
                {
                    bookie: "Betway",
                    odd: "7.5",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "8",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "8",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "7.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864865.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "8",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575142&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Huraiz(IRE)",
            id_horse: "238473",
            jockey: "Marco Ghiani",
            trainer: "Stuart Williams",
            age: "4",
            weight: "9-10",
            number: "1",
            last_ran_days_ago: "14",
            non_runner: "0",
            form: "32670455",
            position: "",
            distance_beaten: "",
            owner: "Mr Hamdan Al Maktoum",
            sire: "SEPOY(AUS)",
            dam: "SAMAAH(IRE)",
            OR: "87",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "9",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462518&amp;affiliatecode=365_00918918&amp;odds=8/1&amp;Instantbet=1&amp;AVG=3169159F9EC52D938C772582A3232826B7DC3FD4",
                },
                {
                    bookie: "Betway",
                    odd: "7.5",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "8.5",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "8",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "8",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864853.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "8.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575166&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Show Me Show Me",
            id_horse: "234340",
            jockey: "Paddy Mathers",
            trainer: "Richard Fahey",
            age: "4",
            weight: "9-85ex",
            number: "3",
            last_ran_days_ago: "7",
            non_runner: "0",
            form: "0-8471001",
            position: "",
            distance_beaten: "",
            owner: "Ontoawinner 8 and Partner 4",
            sire: "SHOWCASING",
            dam: "SPRINGING BARONESS",
            OR: "85",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "9",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462522&amp;affiliatecode=365_00918918&amp;odds=8/1&amp;Instantbet=1&amp;AVG=4E275FA8A9CDBEDDCF4E9752E1EE101ED76CB9FE",
                },
                {
                    bookie: "Betway",
                    odd: "8.5",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "8.5",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "8.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "8.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864856.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "8",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575190&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "The Princes Poet",
            id_horse: "246725",
            jockey: "Georgia Dobie",
            trainer: "Eve Johnson Houghton",
            age: "3",
            weight: "8-10",
            number: "8",
            last_ran_days_ago: "7",
            non_runner: "0",
            form: "8-2515814",
            position: "",
            distance_beaten: "",
            owner: "HP Racing The Princes Poet",
            sire: "BRAZEN BEAU(AUS)",
            dam: "POESY",
            OR: "74",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "9",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462524&amp;affiliatecode=365_00918918&amp;odds=8/1&amp;Instantbet=1&amp;AVG=1487DBF640E801A8FF75C36BBB43663812C88743",
                },
                {
                    bookie: "Betway",
                    odd: "9",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "9",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "8.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "9",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864862.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "8.5",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575150&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Saluti(IRE)",
            id_horse: "213923",
            jockey: "Paul Mulrennan",
            trainer: "Paul Midgley",
            age: "7",
            weight: "9-5",
            number: "4",
            last_ran_days_ago: "19",
            non_runner: "0",
            form: "46471316",
            position: "",
            distance_beaten: "",
            owner: "R Bradley &amp;amp; M Hammond",
            sire: "ACCLAMATION",
            dam: "GREEK EASTER(IRE)",
            OR: "82",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "10",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462521&amp;affiliatecode=365_00918918&amp;odds=9/1&amp;Instantbet=1&amp;AVG=A3CCCA95318F8C5380C7A2F7217A4DBEFFC8273C",
                },
                {
                    bookie: "Betway",
                    odd: "10",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "10",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "10",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "10",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864858.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "10",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575214&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Spoof",
            id_horse: "216935",
            jockey: "Saffie Osborne",
            trainer: "Charles Hills",
            age: "6",
            weight: "9-9",
            number: "2",
            last_ran_days_ago: "35",
            non_runner: "0",
            form: "17-662175",
            position: "",
            distance_beaten: "",
            owner: "Gary and Linnet Woodward",
            sire: "POETS VOICE",
            dam: "FILONA(IRE)",
            OR: "86",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "17",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462523&amp;affiliatecode=365_00918918&amp;odds=16/1&amp;Instantbet=1&amp;AVG=227CB7A123DCF7A3563538EC21C412EC5A68EC23",
                },
                {
                    bookie: "Betway",
                    odd: "17",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "17",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "15",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "17",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864854.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "17",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575206&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Bowling Russian(IRE)",
            id_horse: "237244",
            jockey: "Pat Cosgrave",
            trainer: "George Baker",
            age: "4",
            weight: "9-3",
            number: "6",
            last_ran_days_ago: "6",
            non_runner: "0",
            form: "417-76998",
            position: "",
            distance_beaten: "",
            owner: "Mr P. Bowden",
            sire: "LOPE DE VEGA(IRE)",
            dam: "MINUTE LIMIT(IRE)",
            OR: "80",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "21",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462512&amp;affiliatecode=365_00918918&amp;odds=20/1&amp;Instantbet=1&amp;AVG=2FCF5DF2AFBF7149431EF6503CCDC43FAB6DAE96",
                },
                {
                    bookie: "Betway",
                    odd: "21",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "19",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "21",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "21",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864860.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "21",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575182&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
        {
            horse: "Centurion Song(IRE)",
            id_horse: "237064",
            jockey: "Martin Dwyer",
            trainer: "Brian Meehan",
            age: "4",
            weight: "8-13",
            number: "7",
            last_ran_days_ago: "35",
            non_runner: "0",
            form: "2U471880",
            position: "F",
            distance_beaten: "",
            owner: "Mr B. J. Meehan",
            sire: "CAMACHO",
            dam: "NEW MUSIC(IRE)",
            OR: "76",
            sp: "",
            odds: [
                {
                    bookie: "Bet365",
                    odd: "41",
                    last_update: "2021-09-02 19:16:03",
                    url: "https://mobile.bet365.com/AddToInstantBetSlip.aspx?fid=107362479&;amp;participantid=2072462513&amp;affiliatecode=365_00918918&amp;odds=40/1&amp;Instantbet=1&amp;AVG=677D3BD23B3350CB291F27FEE164DAF58546C155",
                },
                {
                    bookie: "Betway",
                    odd: "41",
                    last_update: "2021-09-02 19:15:01",
                    url: "https://sports.betway.com/en/sports/?s=bw34005&;amp;a=bfpadid80060",
                },
                {
                    bookie: "Unibet",
                    odd: "41",
                    last_update: "2021-09-02 19:15:16",
                    url: "http://adserving.unibet.com/redirect.aspx?pid=13196375&;amp;bid=1&amp;unibetTarget=/betting/racing%23/event/202109021900.T.GBR.newcastle.6/win",
                },
                {
                    bookie: "888Sport",
                    odd: "41",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://mmwebhandler.aff-online.com/C/35447?sr=1652402&;amp;anid=",
                },
                {
                    bookie: "BoyleSports",
                    odd: "41",
                    last_update: "2021-09-02 19:17:01",
                    url: "http://m.boylesports.com/Betslip/AddToBetslip?selId=1362864861.1&;amp;idfiacampaign=42541",
                },
                {
                    bookie: "10Bet",
                    odd: "41",
                    last_update: "2021-09-02 19:17:01",
                    url: "https://10bet.co.uk/mobilegoto.aspx?LineID=1103575198&;amp;siteid=54641&amp;btag=a_54641b_5461c_",
                },
            ],
        },
    ],
};
