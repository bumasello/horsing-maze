"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const tle_DataRouter_1 = require("./router/tle_DataRouter");
const mdb_DataRouter_1 = __importDefault(require("./router/mdb_DataRouter"));
const spb_DataRouter_1 = __importDefault(require("./router/spb_DataRouter"));
const tle_DataRouter_2 = __importDefault(require("./router/tle_DataRouter"));
dotenv_1.default.config();
const port = process.env.PORT || 3000;
const app = (0, express_1.default)();
(0, tle_DataRouter_1.initBot)();
app.use("/mdb_data", mdb_DataRouter_1.default);
app.use("/spb_data", spb_DataRouter_1.default);
app.use("/tle_data", tle_DataRouter_2.default);
app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    console.error(error);
    res.status(status).json({ message: error.message });
});
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "error";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "error";
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
const uri = process.env.MONGOOSE || "error";
mongoose_1.default.connect(uri).then(() => {
    app.listen(port, () => {
        console.log("api on air");
    });
});
