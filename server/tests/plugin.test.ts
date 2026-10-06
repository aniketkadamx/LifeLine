import { describe, it, expect } from "vitest";
import mongoose, { Schema } from "mongoose";
import { toJSONPlugin } from "../src/models/plugins/toJSON.plugin.js";

describe("Base Schema Plugin (toJSONPlugin)", () => {
  it("should transform _id to id and remove __v and private fields", () => {
    // Define a test schema applying the plugin
    const testSchema = new Schema(
      {
        title: { type: String, required: true },
        publicInfo: { type: String },
        internalSecret: { type: String, private: true },
      },
      { timestamps: true }
    );

    testSchema.plugin(toJSONPlugin);

    // Create a local in-memory model (does not need active database connection)
    const TestModel = mongoose.model("TestDocument", testSchema);

    const rawDoc = new TestModel({
      title: "Sample Medical Document",
      publicInfo: "Visible to client",
      internalSecret: "Top Secret Hash Value",
    });

    // Simulate Mongoose __v version key
    rawDoc.__v = 0;

    const jsonOutput = rawDoc.toJSON();

    // 1. Verify id is present and is string version of _id
    expect(jsonOutput).toHaveProperty("id");
    expect(jsonOutput.id).toBe(rawDoc._id.toString());
    expect(jsonOutput).not.toHaveProperty("_id");

    // 2. Verify __v is removed
    expect(jsonOutput).not.toHaveProperty("__v");

    // 3. Verify private fields are stripped
    expect(jsonOutput).not.toHaveProperty("internalSecret");

    // 4. Verify public fields are retained
    expect(jsonOutput.title).toBe("Sample Medical Document");
    expect(jsonOutput.publicInfo).toBe("Visible to client");
  });

  it("should preserve existing custom transform functions if defined", () => {
    const customSchema = new Schema(
      {
        name: { type: String },
      },
      {
        toJSON: {
          transform(_doc, ret) {
            ret.customFlag = true;
            return ret;
          },
        },
      }
    );

    customSchema.plugin(toJSONPlugin);

    const CustomModel = mongoose.model("CustomDocument", customSchema);
    const doc = new CustomModel({ name: "Custom Named Doc" });

    const output = doc.toJSON();

    expect(output.name).toBe("Custom Named Doc");
    expect(output.id).toBe(doc._id.toString());
    expect(output.customFlag).toBe(true);
    expect(output).not.toHaveProperty("_id");
    expect(output).not.toHaveProperty("__v");
  });
});
