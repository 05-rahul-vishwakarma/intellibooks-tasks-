const path = require("path");
const { loadEnvConfig } = require("@next/env");

const dev = process.env.NODE_ENV !== "production";
loadEnvConfig(__dirname, dev);
loadEnvConfig(path.resolve(__dirname, ".."), dev, console, true);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
