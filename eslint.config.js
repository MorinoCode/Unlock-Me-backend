import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["node_modules", "dist"]),
  {
    files: ["**/*.{js,mjs,cjs}"],

   
    plugins: { js },
    extends: ["js/recommended"],

    
    languageOptions: {
      globals: {
        ...globals.browser, 
        ...globals.node,    
      },
    },

    rules: {
      "no-unused-vars": "warn",  
      "no-undef": "error",       
    },
  },
]);
