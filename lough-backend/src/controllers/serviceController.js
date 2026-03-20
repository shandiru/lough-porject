import Service from "../models/service.js";
import Category from "../models/category.js";
import { writeAuditLog } from "../utils/auditLogger.js";
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

    await writeAuditLog({
      user: req.user,
      entity: 'service',
      entityId: savedService._id,
      action: 'service.created',
      description: `Created service: "${name}" — £${price}, ${duration} mins, category: ${populated.category?.name || category}`,
      after: { name, price, duration, depositPercentage, genderRestriction, isActive, category },
      req,
    });

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

    const before = await Service.findById(id).lean();

    const updatedService = await Service.findByIdAndUpdate(id, req.body, {
      returnDocument: "after",
      runValidators: true,
    }).populate("category", "name");

    if (!updatedService) {
      return res.status(404).json({ message: "Service not found" });
    }

    await writeAuditLog({
      user: req.user,
      entity: 'service',
      entityId: id,
      action: 'service.updated',
      description: `Updated service: "${updatedService.name}"`,
      before: before ? { name: before.name, price: before.price, duration: before.duration, isActive: before.isActive, genderRestriction: before.genderRestriction } : null,
      after: { name: updatedService.name, price: updatedService.price, duration: updatedService.duration, isActive: updatedService.isActive, genderRestriction: updatedService.genderRestriction },
      req,
    });

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

    await writeAuditLog({
      user: req.user,
      entity: 'service',
      entityId: id,
      action: 'service.deleted',
      description: `Deleted service: "${deletedService.name}" — £${deletedService.price}, ${deletedService.duration} mins`,
      before: { name: deletedService.name, price: deletedService.price, duration: deletedService.duration },
      req,
    });

    res.status(200).json({ message: "Service deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting service", error: error.message });
  }
};





export const getActiveServicesGrouped = async (req, res) => {
  try {
    const result = await Category.aggregate([
      {
        $match: { isActive: true } 
      },
      {
        $sort: { displayOrder: 1 } 
      },
      {
        $lookup: {
          from: "services",
          let: { categoryId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$category", "$$categoryId"] },
                    { $eq: ["$isActive", true] } 
                  ]
                }
              }
            },
            {
              $sort: { createdAt: -1 }
            }
          ],
          as: "services"
        }
      }
    ]);

    res.status(200).json(result);

  } catch (error) {
    res.status(500).json({
      message: "Error fetching services",
      error: error.message
    });
  }
};



export const getServiceById = async (req, res) => {
  try {
    const service = await Service.findOne({
      _id: req.params.id,
      isActive: true
    }).populate("category", "name");

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    res.json(service);

  } catch (error) {
    res.status(500).json({
      message: "Error fetching service",
      error: error.message
    });
  }
};