import Service from "../models/service.js";

export const getServices = async (req, res) => {
  try {
    const services = await Service.find().populate("category", "name").sort({ createdAt: -1 });
    res.status(200).json(services);
  } catch (error) {
    res.status(500).json({ message: "Error fetching services", error: error.message });
  }
};

export const createService = async (req, res) => {
  try {
    const { name, category, duration, price, depositPercentage, description, genderRestriction, isActive } = req.body;

    const duplicate = await Service.findOne({ name });
    if (duplicate) {
      return res.status(400).json({ message: "Service name already exists" });
    }

    const newService = new Service({
      name,
      category,
      duration,
      price,
      depositPercentage,
      description,
      genderRestriction,
      isActive,
    });

    const savedService = await newService.save();
    const populated = await savedService.populate("category", "name");
    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: "Error creating service", error: error.message });
  }
};

export const updateService = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.body.name) {
      const duplicate = await Service.findOne({ name: req.body.name, _id: { $ne: id } });
      if (duplicate) {
        return res.status(400).json({ message: "Service name already exists" });
      }
    }

    const updatedService = await Service.findByIdAndUpdate(id, req.body, {
      returnDocument: "after",
      runValidators: true,
    }).populate("category", "name");

    if (!updatedService) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.status(200).json(updatedService);
  } catch (error) {
    res.status(400).json({ message: "Error updating service", error: error.message });
  }
};

export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedService = await Service.findByIdAndDelete(id);

    if (!deletedService) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting service", error: error.message });
  }
};