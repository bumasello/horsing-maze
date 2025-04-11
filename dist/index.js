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
const horsesDataRouter_1 = __importDefault(require("./router/horsesDataRouter"));
dotenv_1.default.config();
const port = process.env.PORT || 3000;
const app = (0, express_1.default)();
app.use("/horse", horsesDataRouter_1.default);
app.use((error, _req, res, _next) => {
    const status = error.status || 500;
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
