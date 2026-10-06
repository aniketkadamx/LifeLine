import type { Schema } from "mongoose";

/**
 * Reusable Mongoose schema plugin for consistent JSON serialization across all documents.
 *
 * Responsibilities:
 * 1. Renames `_id` to string `id` for clean REST API responses.
 * 2. Deletes internal Mongoose `__v` version keys.
 * 3. Deletes any schema fields explicitly flagged with `{ private: true }` in their path options.
 * 4. Preserves any pre-existing custom `transform` functions.
 *
 * This plugin remains strictly generic and domain-agnostic.
 */
export function toJSONPlugin(schema: Schema): void {
  const existingTransform = schema.get("toJSON")?.transform as
    | ((doc: any, ret: any, options: any) => any)
    | undefined;

  schema.set("toJSON", {
    virtuals: true,
    transform(doc: any, ret: Record<string, any>, options: any) {
      // 1. Remove MongoDB version key
      delete ret.__v;

      // 2. Convert _id to id string
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }

      // 3. Strip paths explicitly designated as private in schema definition
      schema.eachPath((path, schemaType) => {
        const pathOptions = (schemaType as { options?: { private?: boolean } }).options;
        if (pathOptions && pathOptions.private) {
          delete ret[path];
        }
      });

      // 4. Delegate to prior transform if configured
      if (typeof existingTransform === "function") {
        return existingTransform(doc, ret, options);
      }

      return ret;
    },
  });
}
