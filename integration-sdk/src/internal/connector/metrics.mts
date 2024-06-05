import express from "express";
import PromClient from "prom-client";

export const makeMetrics = async ({ id, name, version }): Promise<void> => {
  const newMetrics = () => {
    const metrics = PromClient;

    const defaultLabels = {
      service: name,
      connectorId: id,
      connectorVersion: version,
      node: process.env.HOSTNAME || "test",
    };
    metrics.register.setDefaultLabels(defaultLabels);
    metrics.collectDefaultMetrics();

    return metrics;
  };

  const makeMetricsServer = (metrics) => {
    const app = express();

    app.get("/metrics", async (request, response, next) => {
      response.status(200);
      response.set("Content-type", metrics.contentType);
      response.send(await metrics.register.metrics());
      response.end();
    });

    return app;
  };

  makeMetricsServer(newMetrics()).listen(4050, "0.0.0.0");
};
